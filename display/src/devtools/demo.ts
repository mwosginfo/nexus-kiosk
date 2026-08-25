import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { ConfigSchema } from '../config.js';
import { createLogger } from '../logger.js';
import { QtechTcpTransport } from '../qtech/tcp-transport.js';
import type { CallEvent } from '../types.js';
import type { AttemptResult } from '../qtech/transport.js';

/**
 * Walks the prototype through the scenarios Qtech's acceptance procedure (§8)
 * asks for, against the reference server. Starts the server, drives the
 * transport, prints what happened, and exits non-zero if anything did not
 * behave as the specification says it should.
 *
 *   npm run demo
 */

const PORT = 19_100;
const BRANCH = 'c761bfe7-0000-4000-8000-000000000001';

function transport(): QtechTcpTransport {
  return new QtechTcpTransport(
    ConfigSchema.parse({
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'unused',
      qtechTransport: 'tcp',
      qtechTcpHost: '127.0.0.1',
      qtechTcpPort: PORT,
      qtechBranchUuid: BRANCH,
      qtechTimeoutMs: 3_000,
    }),
    createLogger({ logLevel: 'error', bridgeId: 'demo' }),
  );
}

function event(over: Partial<CallEvent> = {}): CallEvent {
  return {
    eventId: randomUUID(),
    ticketId: randomUUID(),
    queueNo: '6001',
    counterName: '7',
    silent: false,
    timestamp: new Date().toISOString(),
    signature: 'demo',
    ...over,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  const mark = condition ? '  ok  ' : ' FAIL ';
  if (!condition) failures += 1;
  process.stdout.write(`  [${mark}] ${label}\n           ${detail}\n`);
}

function describe(r: AttemptResult): string {
  switch (r.kind) {
    case 'success':
      return `success${r.duplicate ? ', duplicate:true' : ''} (${r.latencyMs}ms)`;
    case 'business-error':
      return `business error: ${r.code ?? 'unknown'}`;
    case 'transient':
      return `transient: ${r.detail}`;
  }
}

function heading(text: string): void {
  process.stdout.write(`\n\x1b[1m${text}\x1b[0m\n`);
}

async function main(): Promise<void> {
  const server: ChildProcess = spawn(
    process.execPath,
    [
      new URL('./qtech-stub.js', import.meta.url).pathname,
      '--port', String(PORT),
      '--branch', BRANCH,
      '--counters', '3,5,7',
      '--quiet',
    ],
    { stdio: 'inherit' },
  );
  await sleep(600);

  const t = transport();

  try {
    heading('Phase 1 — interface conformance');

    check('liveness', await t.health(), 'endpoint accepts connections');

    const first = await t.call(event({ queueNo: '6001', counterName: '7' }));
    check('a call to an idle counter', first.kind === 'success', describe(first));

    const badCounter = await t.call(event({ counterName: '99' }));
    check(
      'an unknown counter is rejected, not retried',
      badCounter.kind === 'business-error' && badCounter.code === 'COUNTER_UNKNOWN',
      describe(badCounter),
    );

    const badBranch = new QtechTcpTransport(
      ConfigSchema.parse({
        supabaseUrl: 'https://example.supabase.co',
        supabaseKey: 'unused',
        qtechTransport: 'tcp',
        qtechTcpHost: '127.0.0.1',
        qtechTcpPort: PORT,
        qtechBranchUuid: 'wrong-branch',
      }),
      createLogger({ logLevel: 'error', bridgeId: 'demo' }),
    );
    const branchResult = await badBranch.call(event());
    check(
      'an unknown branch is rejected',
      branchResult.kind === 'business-error' && branchResult.code === 'BRANCH_NOT_FOUND',
      describe(branchResult),
    );

    heading('Phase 2 — display behaviour');

    const replace = await t.call(event({ queueNo: '6002', counterName: '7' }));
    check(
      'a second call replaces the first at the same counter',
      replace.kind === 'success',
      describe(replace),
    );

    const [c3, c5] = await Promise.all([
      t.call(event({ queueNo: 'A004', counterName: '3' })),
      t.call(event({ queueNo: '9011', counterName: '5' })),
    ]);
    check(
      'concurrent calls to different counters',
      c3.kind === 'success' && c5.kind === 'success',
      `${describe(c3)} / ${describe(c5)}`,
    );

    const ticket = randomUUID();
    const original = event({ ticketId: ticket, queueNo: '6002', counterName: '7' });
    await t.call(original);
    const recall = await t.call({ ...original, eventId: randomUUID() });
    check(
      'a recall re-announces: same ticket, new event id',
      recall.kind === 'success' && !recall.duplicate,
      describe(recall),
    );

    heading('Phase 3 — failure handling');

    const replay = await t.call(original);
    check(
      'a replayed event id is suppressed',
      replay.kind === 'success' && replay.duplicate,
      describe(replay),
    );

    const silent = await t.call(event({ queueNo: '6003', counterName: '5', silent: true }));
    check(
      'a silent call updates the wall without announcing',
      silent.kind === 'success',
      describe(silent),
    );

    server.kill('SIGKILL');
    await sleep(300);
    const severed = await t.call(event({ queueNo: '6004', counterName: '3' }));
    check(
      'a severed link is transient, so the retry policy applies',
      severed.kind === 'transient',
      describe(severed),
    );
    check('and the endpoint reports not-live', !(await t.health()), 'health probe false');
  } finally {
    server.kill('SIGKILL');
  }

  process.stdout.write(
    failures === 0
      ? '\n\x1b[32mAll scenarios behaved as specified.\x1b[0m\n\n'
      : `\n\x1b[31m${failures} scenario(s) did not behave as specified.\x1b[0m\n\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`demo failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
