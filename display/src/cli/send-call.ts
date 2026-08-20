import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { QtechClient } from '../qtech/client.js';
import { CallResponseSchema, isSuccess } from '../qtech/schemas.js';
import type { CallEvent } from '../types.js';

/**
 * Conformance CLI — drives a single call by hand.
 *
 * Qtech's acceptance procedure (§8) requires calls to be driven from the
 * MWO-OWWA system: a call to an idle counter, a second call replacing the
 * first at the same counter, concurrent calls to different counters, and a
 * repeated call to verify re-announcement. Phase 3 additionally requires a
 * duplicate replayed with the same eventId.
 *
 * Doing that through the live queue would mean calling real clients to real
 * counters. This sends one call directly, using the same client, credentials
 * and payload builder the bridge uses, and prints the raw response so it can
 * be checked against the published schema.
 *
 * Usage:
 *   node dist/src/cli/send-call.js --queue A045 --counter 7
 *   node dist/src/cli/send-call.js --queue A045 --counter 7 --event <uuid>
 *   node dist/src/cli/send-call.js --health
 */

interface Args {
  readonly queue: string | null;
  readonly counter: string | null;
  readonly ticket: string | null;
  readonly event: string | null;
  readonly silent: boolean;
  readonly health: boolean;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  return {
    queue: get('queue'),
    counter: get('counter'),
    ticket: get('ticket'),
    event: get('event'),
    silent: argv.includes('--silent'),
    health: argv.includes('--health'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

const USAGE = `
Send one call to Qtech, using the configured credentials.

  --queue <n>      Queue number exactly as it should appear, e.g. A045
  --counter <n>    Counter name, e.g. 7
  --ticket <id>    Ticket id (default: a fresh UUID)
  --event <uuid>   Event id (default: a fresh UUID)
                   Pass the SAME value twice to test duplicate suppression.
                   Pass a NEW value with the same --ticket to test a recall.
  --silent         Suppress chime and voice on the display
  --health         Probe GET /health instead of sending a call

Reads the same environment as the bridge. On the Pi:
  sudo systemctl show nexus-qtech-bridge -p EnvironmentFiles   # confirm path
  sudo env $(grep -v '^#' /etc/nexus-qtech-bridge.env | xargs) \\
    node /opt/nexus-qtech-bridge/dist/src/cli/send-call.js --queue A045 --counter 7
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const config = loadConfig();
  const logger = createLogger({ logLevel: 'error', bridgeId: 'cli' });
  const client = new QtechClient(config, logger);

  if (args.health) {
    const ok = await client.health();
    process.stdout.write(`GET /health -> ${ok ? 'OK' : 'NOT OK'}\n`);
    process.exit(ok ? 0 : 1);
  }

  if (!args.queue || !args.counter) {
    process.stderr.write('--queue and --counter are required.\n' + USAGE);
    process.exit(2);
  }

  const event: CallEvent = {
    eventId: args.event ?? randomUUID(),
    ticketId: args.ticket ?? randomUUID(),
    queueNo: args.queue,
    counterName: args.counter,
    silent: args.silent,
    timestamp: new Date().toISOString(),
    signature: 'cli',
  };

  const result = await client.rawCall(event);

  process.stdout.write(`\nrequest  POST ${config.qtechBaseUrl}/call\n`);
  process.stdout.write(`${JSON.stringify(result.request, null, 2)}\n`);
  process.stdout.write(`\nresponse HTTP ${result.httpStatus}  (${result.latencyMs} ms)\n`);

  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(result.body);
    process.stdout.write(`${JSON.stringify(parsedBody, null, 2)}\n`);
  } catch {
    process.stdout.write(`${result.body}\n`);
  }

  // Qtech signals a business error inside a 200 response body, so HTTP status
  // alone is not the outcome. A conformance tool that exits 0 on
  // response:"Error" would let a failing check pass unnoticed in a script.
  const httpOk = result.httpStatus >= 200 && result.httpStatus < 300;
  const parsed = CallResponseSchema.safeParse(parsedBody);
  const businessOk = parsed.success ? isSuccess(parsed.data) : false;
  const ok = httpOk && businessOk;

  process.stdout.write(`\nresult   ${ok ? 'SUCCESS' : 'FAILED'}\n\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
