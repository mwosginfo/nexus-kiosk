import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { ConfigSchema, type Config } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { QtechTcpTransport } from '../src/qtech/tcp-transport.js';
import { encodeFrame, type TcpFraming } from '../src/qtech/framing.js';
import type { CallEvent } from '../src/types.js';

/**
 * The TCP transport against a real TCP server. Qtech confirmed the JSON is
 * unchanged and only the carrier differs, so these assert that the same
 * payload goes out and the same response envelope is understood — plus the
 * stream-level failures HTTP used to handle for us.
 */

interface Harness {
  readonly server: Server;
  readonly received: string[];
  readonly port: number;
}

async function startServer(
  onMessage: (msg: string, socket: Socket, index: number) => void,
  framing: TcpFraming = 'newline',
): Promise<Harness> {
  const received: string[] = [];
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (framing === 'newline') {
        let i: number;
        while ((i = buf.indexOf(0x0a)) !== -1) {
          const msg = buf.subarray(0, i).toString('utf8');
          buf = buf.subarray(i + 1);
          received.push(msg);
          onMessage(msg, socket, received.length - 1);
        }
      } else if (framing === 'length') {
        while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
          const len = buf.readUInt32BE(0);
          const msg = buf.subarray(4, 4 + len).toString('utf8');
          buf = buf.subarray(4 + len);
          received.push(msg);
          onMessage(msg, socket, received.length - 1);
        }
      } else {
        received.push(buf.toString('utf8'));
        onMessage(buf.toString('utf8'), socket, received.length - 1);
        buf = Buffer.alloc(0);
      }
    });
    socket.on('error', () => { /* client hangs up; not a test failure */ });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, received, port: (server.address() as AddressInfo).port };
}

function makeConfig(port: number, over: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'k',
    qtechTransport: 'tcp',
    qtechTcpHost: '127.0.0.1',
    qtechTcpPort: port,
    qtechBranchUuid: 'mwo',
    qtechClientId: 'mwo-owwa',
    qtechAuthToken: 'QT-MWO-testtoken',
    qtechTimeoutMs: 2_000,
    qtechAckWaitMs: 150,
    ...over,
  });
}

function transport(port: number, over: Partial<Config> = {}): QtechTcpTransport {
  return new QtechTcpTransport(
    makeConfig(port, over),
    createLogger({ logLevel: 'error', bridgeId: 'test' }),
  );
}

function event(over: Partial<CallEvent> = {}): CallEvent {
  return {
    eventId: 'b3f1c2e0-1111-5111-8111-111111111111',
    ticketId: '11111111-1111-4111-8111-111111111111',
    queueNo: 'A045',
    counterName: '7',
    silent: false,
    timestamp: '2026-08-20T09:14:22+08:00',
    signature: 'sig',
    ...over,
  };
}

test('sends exactly the fields Qtech\'s own client sends', async () => {
  // Transcribed from the call.bat reference. Extra fields are not added: their
  // parser has never been shown one, and with no error channel we would never
  // learn if it rejected the message.
  const h = await startServer(() => { /* fire-and-forget, no reply */ });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');

    const sent = JSON.parse(h.received[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sent).sort(), [
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
    assert.equal(sent.type, 'CALL');
    assert.equal(sent.clientId, 'mwo-owwa');
    assert.equal(sent.branchUUID, 'mwo');
    assert.equal(sent.queueNo, 'A045');
    assert.equal(sent.counterName, '7');
    assert.equal(sent.silent, false, 'silent is always present, not omitted');
    assert.equal(sent.ticketID, '11111111-1111-4111-8111-111111111111');
  } finally {
    h.server.close();
  }
});

test('no eventId is put on the wire', async () => {
  // Their protocol has no idempotency key. Sending one anyway risks a silent
  // rejection we could never observe.
  const h = await startServer(() => { /* no reply */ });
  try {
    await transport(h.port).call(event());
    const sent = JSON.parse(h.received[0]!) as Record<string, unknown>;
    assert.equal('eventId' in sent, false);
  } finally {
    h.server.close();
  }
});

test('a message is newline-terminated, as their client writes it', async () => {
  const raw: Buffer[] = [];
  const server = createServer((socket) => {
    socket.on('data', (c) => raw.push(c));
    socket.on('error', () => { /* ignore */ });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await transport((server.address() as AddressInfo).port).call(event());
    await new Promise((r) => setTimeout(r, 100));
    const bytes = Buffer.concat(raw);
    assert.equal(bytes[bytes.length - 1], 0x0a, 'must end with \\n');
  } finally {
    server.close();
  }
});

test('no personal data crosses the wire', async () => {
  const h = await startServer(() => { /* no reply */ });
  try {
    await transport(h.port).call(event());
    const sent = JSON.parse(h.received[0]!) as Record<string, unknown>;

    // Assert on keys, not substrings: `counterName` legitimately contains
    // "name". The Nexus row behind a call carries these; none may appear.
    for (const forbidden of [
      'clientName',
      'client_name',
      'clientEmail',
      'client_email',
      'refCode',
      'ref_code',
      'transactionRef',
      'transaction_ref',
      'ofwFname',
      'ofwLname',
    ]) {
      assert.ok(!(forbidden in sent), `payload leaked "${forbidden}"`);
    }

    // And the ticket id must be opaque — a UUID, not anything meaningful.
    assert.match(String(sent.ticketID), /^[0-9a-f-]{36}$/);
  } finally {
    h.server.close();
  }
});

test('a silent server is the normal path and counts as sent', async () => {
  // Qtech's client writes and closes without reading. A server that never
  // replies is expected behaviour, not a failure.
  const h = await startServer(() => { /* accept, say nothing */ });
  try {
    const started = Date.now();
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');
    assert.ok(Date.now() - started < 1_500, 'must not wait for a reply that will not come');
  } finally {
    h.server.close();
  }
});

test('with ack-wait disabled it mirrors their client exactly', async () => {
  const h = await startServer(() => { /* no reply */ });
  try {
    const started = Date.now();
    const result = await transport(h.port, { qtechAckWaitMs: 0 }).call(event());
    assert.equal(result.kind, 'success');
    assert.ok(Date.now() - started < 200, 'no grace period at all');
  } finally {
    h.server.close();
  }
});

test('length-prefixed framing works end to end', async () => {
  const h = await startServer(() => { /* no reply */ }, 'length');
  try {
    const result = await transport(h.port, { qtechTcpFraming: 'length' }).call(event());
    assert.equal(result.kind, 'success');
    assert.equal(h.received.length, 1);
  } finally {
    h.server.close();
  }
});

test('an unpromised acknowledgement is picked up when one arrives', async () => {
  // Their protocol promises nothing, but if the endpoint does reply we take
  // it, and the retry rule works properly again without a code change.
  const h = await startServer((_msg, socket) => {
    socket.write(encodeFrame(JSON.stringify({ response: 'Success' }), 'newline'));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');
    assert.equal(result.kind === 'success' && result.httpStatus, 1, 'marked acknowledged');
  } finally {
    h.server.close();
  }
});

test('an error acknowledgement is reported and not retried', async () => {
  for (const code of ['BRANCH_NOT_FOUND', 'COUNTER_UNKNOWN', 'VALIDATION_ERROR', 'AUTH_FAILED']) {
    const h = await startServer((_msg, socket) => {
      socket.write(encodeFrame(JSON.stringify({ response: 'Error', code }), 'newline'));
    });
    try {
      const result = await transport(h.port).call(event());
      assert.equal(result.kind, 'business-error', code);
      assert.equal(result.kind === 'business-error' && result.code, code);
    } finally {
      h.server.close();
    }
  }
});

test('an acknowledgement delivered in fragments is still understood', async () => {
  const h = await startServer((_msg, socket) => {
    const frame = encodeFrame(JSON.stringify({ response: 'Success' }), 'newline');
    for (const byte of frame) socket.write(Buffer.from([byte]));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');
  } finally {
    h.server.close();
  }
});

test('a refused connection is transient, so the retry policy applies', async () => {
  // Port 1 on loopback: nothing is listening.
  const result = await transport(1).call(event());
  assert.equal(result.kind, 'transient');
});

test('an unreachable host fails as transient, so the retry policy applies', async () => {
  // Under fire-and-forget the only failures we can observe are at the
  // connection level. This is one of them: nothing answers at all.
  const t = new QtechTcpTransport(
    ConfigSchema.parse({
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'k',
      qtechTransport: 'tcp',
      qtechTcpHost: '10.255.255.1',
      qtechTcpPort: 4009,
      qtechBranchUuid: 'mwo',
      qtechAuthToken: 't',
      qtechTimeoutMs: 1_000,
    }),
    createLogger({ logLevel: 'error', bridgeId: 'test' }),
  );
  const started = Date.now();
  const result = await t.call(event());
  assert.equal(result.kind, 'transient');
  assert.ok(Date.now() - started < 3_000, 'must give up on its own timeout');
});

test('a peer that hangs up after accepting the write counts as sent', async () => {
  // Indistinguishable from their normal behaviour: the bytes were written and
  // accepted. This is the honest limit of a fire-and-forget protocol.
  const h = await startServer((_msg, socket) => socket.destroy());
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');
  } finally {
    h.server.close();
  }
});

test('a non-JSON acknowledgement is a business error, not an endless retry', async () => {
  const h = await startServer((_msg, socket) => {
    socket.write(encodeFrame('<html>gateway</html>', 'newline'));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'business-error');
    assert.equal(result.kind === 'business-error' && result.code, 'UNPARSEABLE_ACK');
  } finally {
    h.server.close();
  }
});

test('silent is always present, true only when set', async () => {
  const h = await startServer(() => { /* no reply */ });
  try {
    const t = transport(h.port);
    await t.call(event());
    await t.call(event({ silent: true, eventId: 'aaaaaaaa-1111-5111-8111-111111111111' }));
    assert.equal((JSON.parse(h.received[0]!) as Record<string, unknown>).silent, false);
    assert.equal((JSON.parse(h.received[1]!) as Record<string, unknown>).silent, true);
  } finally {
    h.server.close();
  }
});

test('each call uses its own connection', async () => {
  // Per-call connections are what keep a half-open socket from silently
  // swallowing announcements. Verify we are not quietly reusing one.
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.on('error', () => { /* ignore */ });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const t = transport(port);
    await t.call(event());
    await t.call(event({ eventId: 'bbbbbbbb-1111-5111-8111-111111111111' }));
    assert.equal(connections, 2);
  } finally {
    server.close();
  }
});

test('the health probe reflects whether the endpoint accepts connections', async () => {
  const h = await startServer(() => { /* nothing */ });
  try {
    assert.equal(await transport(h.port).health(), true);
  } finally {
    h.server.close();
  }
  assert.equal(await transport(1).health(), false);
});

test('dry run sends nothing but still reports an outcome', async () => {
  const h = await startServer(() => { /* nothing */ });
  try {
    const result = await transport(h.port, { dryRun: true }).call(event());
    assert.equal(result.kind, 'success');
    assert.equal(h.received.length, 0);
  } finally {
    h.server.close();
  }
});
