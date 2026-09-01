/**
 * Boot smoke test. Starts stub Supabase-REST and Qtech servers, runs the built
 * bridge against them, and asserts it comes up, seeds, probes Qtech, writes a
 * heartbeat, and shuts down cleanly on SIGTERM.
 *
 * Not part of `npm test` — it spawns a process and binds sockets. Run with:
 *   npm run build && node test/smoke.mjs
 */
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const calls = { rest: [], qtech: [], health: [], callBodies: [] };

/** One CALLED row, served from the second kiosk_checkins read onward, so the
 *  boot seed sees an empty queue and the reconcile poll discovers a new call. */
const CALLED_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'CALLED',
  queue_number: 45,
  display_number: 'A045',
  queue_series: 'FRA',
  counter_number: 7,
  called_at: '2026-08-20T01:14:22.000Z',
  last_called_at: null,
  call_count: null,
  queue_date: null,
};
let kioskReads = 0;

function jsonServer(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const supabase = await jsonServer((req, res, body) => {
  calls.rest.push(req.url);
  if (req.url.includes('qtech_bridge_health')) {
    calls.health.push(JSON.parse(body || '[]'));
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end('[]');
    return;
  }
  if (req.url.includes('kiosk_checkins')) {
    kioskReads += 1;
    // Read 1 = boot seed (empty). Read 2+ = a number has been called.
    const rows = kioskReads === 1 ? [] : [{ ...CALLED_ROW, queue_date: sgtToday() }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('[]');
});

function sgtToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// Qtech stub: newline-framed JSON over TCP, matching the live transport.
const qtech = await new Promise((resolve) => {
  let connections = 0;
  const server = createTcpServer((socket) => {
    connections += 1;
    calls.qtech.push('tcp-connect');
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let i;
      while ((i = buf.indexOf(0x0a)) !== -1) {
        const msg = buf.subarray(0, i).toString('utf8');
        buf = buf.subarray(i + 1);
        const parsed = JSON.parse(msg);
        calls.callBodies.push({ body: parsed });
        // Qtech's endpoint replies with nothing; mirror that.
      }
    });
    socket.on('error', () => {});
  });
  server.listen(0, '127.0.0.1', () =>
    resolve({ server, port: server.address().port, get connections() { return connections; } }),
  );
});

const child = spawn(process.execPath, ['dist/src/index.js'], {
  env: {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${supabase.port}`,
    SUPABASE_KEY: 'test-key',
    QTECH_TRANSPORT: 'tcp',
    QTECH_TCP_HOST: '127.0.0.1',
    QTECH_TCP_PORT: String(qtech.port),
    QTECH_TCP_FRAMING: 'newline',
    QTECH_BRANCH_UUID: 'mwo',
    QTECH_AUTH_TOKEN: 'QT-MWO-smoke',
    QTECH_ACK_WAIT_MS: '100',
    HEARTBEAT_INTERVAL_MS: '5000',
    RECONCILE_INTERVAL_MS: '2000',
    QTECH_HEALTH_INTERVAL_MS: '30000',
    LOG_LEVEL: 'info',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => (out += d.toString()));
child.stderr.on('data', (d) => (out += d.toString()));

await new Promise((r) => setTimeout(r, 6000));
child.kill('SIGTERM');
const code = await new Promise((r) => child.on('exit', r));

supabase.server.close();
qtech.server.close();

const lines = out.trim().split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return { msg: l }; }
});
const messages = lines.map((l) => l.msg);

console.log(messages.map((m) => `  · ${m}`).join('\n'));

assert.ok(messages.includes('starting nexus-qtech-bridge'), 'should start');
assert.ok(messages.includes('seeded call cache from current state'), 'should seed');
assert.ok(messages.includes('bridge running'), 'should reach running state');
assert.ok(messages.includes('shutdown complete'), 'should shut down cleanly');
assert.equal(code, 0, 'should exit 0 on SIGTERM');

assert.ok(calls.qtech.includes('tcp-connect'), 'should reach the Qtech endpoint over TCP');
assert.ok(calls.health.length > 0, 'should write a heartbeat row');
// Boot seed reads a wider status set (so the resync cannot re-assert a stale
// call at a counter whose newest ticket has already moved on); the reconcile
// poll reads CALLED only.
const kioskUrls = calls.rest.filter((u) => u.includes('kiosk_checkins'));
assert.ok(kioskUrls.length >= 2, 'should seed then poll');
assert.match(decodeURIComponent(kioskUrls[0]), /status=in\.\(.*CALLED.*PROCESSING.*RECEIVED.*\)/);
assert.match(decodeURIComponent(kioskUrls[1]), /status=in\.\(.*CALLED.*\)/);
assert.ok(
  kioskUrls.every((u) => u.includes(`queue_date=eq.${sgtToday()}`)),
  'every read must be scoped to the SGT operating day',
);

// ── the whole point: a CALLED row must become exactly one POST /call ──────
assert.equal(calls.callBodies.length, 1, 'exactly one call delivered, not one per poll');
const delivered = calls.callBodies[0];
assert.deepEqual(Object.keys(delivered.body).sort(), [
  'authToken',
  'branchUUID',
  'clientId',
  'counterName',
  'queueNo',
  'silent',
  'ticketID',
  'timestamp',
  'type',
]);
assert.equal(delivered.body.type, 'CALL');
// Default ticket style matches Qtech's client: T + epoch millis. Opaque
// either way — neither form encodes anything about the person.
assert.match(delivered.body.ticketID, /^T\d{13}$/);
assert.equal(delivered.body.queueNo, 'A045');
assert.equal(delivered.body.counterName, '7');
assert.equal(delivered.body.branchUUID, 'mwo');
// No eventId on the wire: Qtech's protocol has no idempotency key.
assert.equal('eventId' in delivered.body, false);

const beat = calls.health.at(-1);
const row = Array.isArray(beat) ? beat[0] : beat;
assert.equal(row.bridge_id, 'mwo-owwa-primary');
assert.equal(typeof row.updated_at, 'string');
assert.equal(row.dry_run, false);
assert.equal(row.sent_today, 1, 'heartbeat reports the delivered call');
assert.equal(row.failed_today, 0);

console.log('\nsmoke: OK');
