#!/usr/bin/env node
/*
 * MWO-OWWA -> Qtech queue display: minimal reference of what our bridge sends.
 *
 * Standalone, no dependencies. This is the exact message our production bridge
 * puts on the wire, reduced to the smallest runnable form so it can be read
 * and tested quickly.
 *
 *   node qtech-sample-client.cjs A045 7
 *   node qtech-sample-client.cjs 6034 3
 *
 * Config via environment, or edit the constants below:
 *   QTECH_TCP_HOST   default 10.253.158.127
 *   QTECH_TCP_PORT   default 4009
 *   QTECH_AUTH_TOKEN required
 *
 * Modelled directly on the call.bat reference supplied 2026-08-20:
 *   - one TCP connection per call, write, close
 *   - one UTF-8 JSON object terminated by a single \n (0x0A)
 *   - the same nine fields
 *   - no read: we do not expect a reply
 */

const net = require('net');

const HOST = process.env.QTECH_TCP_HOST || '10.253.158.127';
const PORT = Number(process.env.QTECH_TCP_PORT || 4009);
const TOKEN = process.env.QTECH_AUTH_TOKEN || '';
const CLIENT_ID = process.env.QTECH_CLIENT_ID || 'mwo-owwa';
const BRANCH = process.env.QTECH_BRANCH_UUID || 'mwo';

const queueNo = process.argv[2] || 'A045';
const counterName = process.argv[3] || '7';

/*
 * Timestamp: yyyy-MM-ddTHH:mm:ss+08:00, matching
 * `Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'` in call.bat.
 * No milliseconds, no Z. Singapore is a fixed UTC+8, no daylight saving.
 */
function sgtTimestamp() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19) + '+08:00';
}

/*
 * Ticket id: 'T' + epoch milliseconds, matching call.bat.
 *
 * Our bridge can alternatively send the check-in record's UUID, which is
 * collision-free and never reused — closer to what section 6 of the 5 August
 * integration response asks for. We default to your format in case the field
 * is validated on your side. Either is fine by us; please confirm which you
 * prefer.
 */
function ticketId() {
  return 'T' + Date.now();
}

const message = {
  type: 'CALL',
  ticketID: ticketId(),
  clientId: CLIENT_ID,
  branchUUID: BRANCH,
  counterName: counterName,   // string, "1".."10"
  queueNo: queueNo,           // displayed verbatim
  silent: false,              // true only to update the wall without a chime
  timestamp: sgtTimestamp(),  // audit only
  authToken: TOKEN,
};

const line = JSON.stringify(message) + '\n';

if (!TOKEN) {
  console.error('QTECH_AUTH_TOKEN is not set — refusing to send.');
  process.exit(2);
}

console.log('connecting  ' + HOST + ':' + PORT);
console.log('sending     ' + Buffer.byteLength(line) + ' bytes');
console.log(line.trim());

const socket = net.connect(PORT, HOST, () => {
  socket.write(line, (err) => {
    if (err) {
      console.error('write failed: ' + err.message);
      process.exit(1);
    }
    console.log('result      written and flushed');
    // We hold the socket open briefly in case a reply is sent. call.bat closes
    // immediately; we listen only because a reply would be useful to us.
    setTimeout(() => { socket.end(); process.exit(0); }, 500);
  });
});

socket.setTimeout(10000);
socket.on('data', (d) => console.log('reply       ' + d.toString().trim()));
socket.on('timeout', () => { console.error('result      timed out'); socket.destroy(); process.exit(1); });
socket.on('error', (e) => { console.error('result      ' + (e.code || e.message)); process.exit(1); });
