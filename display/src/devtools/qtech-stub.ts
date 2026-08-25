import { createServer, type Socket } from 'node:net';
import { FrameReader, TcpFramingSchema, encodeFrame, type TcpFraming } from '../qtech/framing.js';

/**
 * Reference Qtech server.
 *
 * A faithful implementation of the semantics in the 5 August integration
 * response, carried over TCP instead of HTTPS. It exists for three reasons:
 *
 *  1. It makes the proposal concrete. Rather than asking Qtech to describe a
 *     protocol in prose, we hand them a running server and a specification
 *     that matches it, and ask them to confirm or correct.
 *  2. It lets MWO rehearse Qtech's own acceptance phases 1 to 3 before their
 *     equipment is available.
 *  3. It is a regression harness: the bridge can be pointed at it in CI.
 *
 * Behaviours it reproduces from their document:
 *   §2  a number stays on its counter until that counter calls another
 *   §4  a repeated eventId within 10 minutes returns duplicate:true and does
 *       not re-announce
 *   §1  BRANCH_NOT_FOUND, COUNTER_UNKNOWN and VALIDATION_ERROR, with the
 *       offending field named
 *
 * This is a development tool. It is not the bridge and is never installed as
 * a service.
 */

interface Options {
  readonly port: number;
  readonly host: string;
  readonly framing: TcpFraming;
  readonly branchUuid: string | null;
  readonly counters: readonly string[];
  readonly duplicateWindowMs: number;
  /** Reject this fraction of calls with a transient failure, to exercise retry. */
  readonly failRate: number;
  /** Artificial delay before replying, in ms. */
  readonly delayMs: number;
  readonly quiet: boolean;
}

interface WallEntry {
  readonly queueNo: string;
  readonly at: Date;
  readonly announced: boolean;
}

const REQUIRED = ['eventId', 'ticketID', 'branchUUID', 'counterName', 'queueNo', 'timestamp'] as const;

function parseArgs(argv: readonly string[]): Options {
  const get = (name: string, fallback?: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  return {
    port: Number(get('port', '9100')),
    host: get('host', '127.0.0.1') ?? '127.0.0.1',
    framing: TcpFramingSchema.parse(get('framing', 'newline')),
    branchUuid: get('branch') ?? null,
    counters: (get('counters', '1,2,3,4,5,6,7,8,9,10') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    duplicateWindowMs: Number(get('duplicate-window', String(10 * 60 * 1000))),
    failRate: Number(get('fail-rate', '0')),
    delayMs: Number(get('delay', '0')),
    quiet: argv.includes('--quiet'),
  };
}

/** The wall: last number called at each counter. Never cleared, per §2. */
const wall = new Map<string, WallEntry>();
/** eventId -> the outcome first returned for it, and when. */
const seen = new Map<string, { at: number; body: unknown }>();

function ok(msg: Record<string, unknown>): unknown {
  return { response: 'Success', message: msg };
}

function err(code: string, detail?: string): unknown {
  return { response: 'Error', code, ...(detail ? { field: detail } : {}) };
}

function handle(raw: string, opts: Options): unknown {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return err('VALIDATION_ERROR', 'body must be a JSON object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return err('VALIDATION_ERROR', 'body is not valid JSON');
  }

  for (const field of REQUIRED) {
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0) {
      return err('VALIDATION_ERROR', field);
    }
  }
  if ('silent' in body && typeof body.silent !== 'boolean') {
    return err('VALIDATION_ERROR', 'silent');
  }
  if (String(body.ticketID).length > 64) {
    return err('VALIDATION_ERROR', 'ticketID exceeds 64 characters');
  }

  const eventId = String(body.eventId);
  const ticketID = String(body.ticketID);
  const counterName = String(body.counterName);
  const queueNo = String(body.queueNo);
  const silent = body.silent === true;

  // §4 — a repeat of the same eventId inside the window returns the original
  // outcome and does not re-announce.
  const prior = seen.get(eventId);
  if (prior && Date.now() - prior.at < opts.duplicateWindowMs) {
    const original = prior.body as { message?: Record<string, unknown> };
    log(opts, `  duplicate  ${queueNo} -> counter ${counterName}  (suppressed)`);
    return ok({ ...(original.message ?? {}), duplicate: true });
  }

  if (opts.branchUuid !== null && body.branchUUID !== opts.branchUuid) {
    return err('BRANCH_NOT_FOUND');
  }
  if (opts.counters.length > 0 && !opts.counters.includes(counterName)) {
    return err('COUNTER_UNKNOWN');
  }

  // §2 — replaces whatever that counter was showing; nothing else changes.
  wall.set(counterName, { queueNo, at: new Date(), announced: !silent });

  const response = ok({
    eventId,
    ticketID,
    queueNo,
    counterName,
    status: 'ON_CALL',
    serverTime: new Date().toISOString(),
    duplicate: false,
  });
  seen.set(eventId, { at: Date.now(), body: response });

  log(opts, `  call       ${queueNo} -> counter ${counterName}${silent ? '  (silent)' : '  ♪ chime + voice'}`);
  paintWall(opts);
  return response;
}

function paintWall(opts: Options): void {
  if (opts.quiet) return;
  const rows = [...wall.entries()].sort((a, b) => b[1].at.getTime() - a[1].at.getTime());
  if (rows.length === 0) return;
  const lines = rows.map(
    ([counter, e]) =>
      `      ${e.queueNo.padEnd(8)} counter ${counter.padEnd(3)} ${e.at.toLocaleTimeString('en-SG')}`,
  );
  process.stdout.write(
    `\n      ── now serving ────────────────────────────\n${lines.join('\n')}\n` +
      `      ───────────────────────────────────────────\n\n`,
  );
}

function log(opts: Options, line: string): void {
  if (!opts.quiet) process.stdout.write(`${line}\n`);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  const server = createServer((socket: Socket) => {
    const reader = new FrameReader(opts.framing);

    const reply = (body: unknown): void => {
      const json = JSON.stringify(body);
      const send = (): void => {
        socket.write(encodeFrame(json, opts.framing));
        if (opts.framing === 'raw') socket.end();
      };
      if (opts.delayMs > 0) setTimeout(send, opts.delayMs);
      else send();
    };

    const process_ = (raw: string): void => {
      if (opts.failRate > 0 && Math.random() < opts.failRate) {
        log(opts, '  inject     dropping connection to exercise retry');
        socket.destroy();
        return;
      }
      reply(handle(raw, opts));
    };

    socket.on('data', (chunk: Buffer) => {
      try {
        reader.push(chunk);
        let msg = reader.next();
        while (msg !== null) {
          process_(msg);
          msg = reader.next();
        }
      } catch (e) {
        log(opts, `  error      ${e instanceof Error ? e.message : String(e)}`);
        socket.destroy();
      }
    });
    socket.on('end', () => {
      const rest = reader.flush();
      if (rest !== null) process_(rest);
    });
    socket.on('error', () => { /* client hung up */ });
  });

  server.listen(opts.port, opts.host, () => {
    process.stdout.write(
      `\nQtech reference server\n` +
        `  listening   ${opts.host}:${opts.port}\n` +
        `  framing     ${opts.framing}\n` +
        `  branch      ${opts.branchUuid ?? '(any)'}\n` +
        `  counters    ${opts.counters.join(', ') || '(any)'}\n` +
        `  duplicates  suppressed within ${Math.round(opts.duplicateWindowMs / 1000)}s\n` +
        (opts.failRate > 0 ? `  fail rate   ${opts.failRate}\n` : '') +
        (opts.delayMs > 0 ? `  delay       ${opts.delayMs}ms\n` : '') +
        `\nwaiting for calls…\n\n`,
    );
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

main();
