#!/usr/bin/env node
/*
 * Qtech endpoint probe.
 *
 * Sends a series of deliberately varied CALL messages, each with a distinct
 * queue number, so that if any one of them reaches the display the wall itself
 * identifies which. Everything about this protocol is silent, so the screen is
 * the only readout we have.
 *
 *   QTECH_AUTH_TOKEN=... node qtech-probe.cjs
 *
 * Watch the wall while it runs. Note any number that appears, then map it back
 * to the variant below.
 *
 * The first probe also holds the socket open for 10 seconds to establish, once
 * and for all, whether the endpoint ever sends anything back.
 */
const net = require('net');

const HOST = process.env.QTECH_TCP_HOST || '10.253.158.127';
const PORT = Number(process.env.QTECH_TCP_PORT || 4009);
const TOKEN = process.env.QTECH_AUTH_TOKEN || '';
if (!TOKEN) { console.error('QTECH_AUTH_TOKEN is not set.'); process.exit(2); }

const sgt = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19) + '+08:00';
const uuid = () => '11111111-2222-4333-8444-' + Date.now().toString().padStart(12, '0');

const base = () => ({
  type: 'CALL',
  ticketID: 'T' + Date.now(),
  clientId: 'mwo-owwa',
  branchUUID: 'mwo',
  counterName: '7',
  queueNo: 'A901',
  silent: false,
  timestamp: sgt(),
  authToken: TOKEN,
});

const variants = [
  ['A901', 'baseline — identical to call.bat',      (m) => m],
  ['A902', 'counter 1 instead of 7',                (m) => ({ ...m, counterName: '1' })],
  ['A903', 'silent: true',                          (m) => ({ ...m, silent: true })],
  ['A904', 'branchUUID uppercase MWO',              (m) => ({ ...m, branchUUID: 'MWO' })],
  ['A905', 'ticketID as a UUID',                    (m) => ({ ...m, ticketID: uuid() })],
  ['A906', 'silent field omitted entirely',         (m) => { const c = { ...m }; delete c.silent; return c; }],
  ['A907', 'timestamp as UTC ISO with Z',           (m) => ({ ...m, timestamp: new Date().toISOString() })],
  ['A908', 'counterName as "Counter 7"',            (m) => ({ ...m, counterName: 'Counter 7' })],
];

function send(msg, holdMs) {
  return new Promise((resolve) => {
    const line = JSON.stringify(msg) + '\n';
    const s = net.connect(PORT, HOST, () => {
      s.write(line, () => {
        if (holdMs > 0) {
          setTimeout(() => { s.end(); resolve('sent (no reply in ' + holdMs + 'ms)'); }, holdMs);
        } else {
          setTimeout(() => { s.end(); resolve('sent'); }, 400);
        }
      });
    });
    s.setTimeout(15000);
    s.on('data', (d) => resolve('REPLY RECEIVED: ' + d.toString().trim()));
    s.on('timeout', () => { s.destroy(); resolve('timed out'); });
    s.on('error', (e) => resolve('ERROR ' + (e.code || e.message)));
  });
}

(async () => {
  console.log('probing ' + HOST + ':' + PORT + ' — watch the display\n');
  for (let i = 0; i < variants.length; i++) {
    const [queueNo, label, mutate] = variants[i];
    const msg = mutate({ ...base(), queueNo, ticketID: 'T' + Date.now() });
    const hold = i === 0 ? 10000 : 0;
    process.stdout.write('  ' + queueNo + '  ' + label.padEnd(38));
    const result = await send(msg, hold);
    console.log(result);
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('\nIf a number appeared, note which — that identifies the variant.');
  console.log('If none did, nothing we send is being displayed and it is their side.');
})();
