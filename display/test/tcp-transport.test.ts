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
    qtechBranchUuid: 'c761bfe7',
    qtechTimeoutMs: 2_000,
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

function success(msg: string, duplicate = false): string {
  const req = JSON.parse(msg) as { eventId: string };
  return JSON.stringify({
    response: 'Success',
    message: { eventId: req.eventId, status: 'ON_CALL', duplicate },
  });
}

test('sends the same JSON payload the HTTP interface used', async () => {
  const h = await startServer((msg, socket) => {
    socket.write(encodeFrame(success(msg), 'newline'));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');

    const sent = JSON.parse(h.received[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sent).sort(), [
      'branchUUID',
      'counterName',
      'eventId',
      'queueNo',
      'ticketID',
      'timestamp',
    ]);
    assert.equal(sent.queueNo, 'A045');
    assert.equal(sent.counterName, '7');
    assert.equal(sent.ticketID, '11111111-1111-4111-8111-111111111111');
  } finally {
    h.server.close();
  }
});

test('no personal data crosses the wire', async () => {
  const h = await startServer((msg, socket) => {
    socket.write(encodeFrame(success(msg), 'newline'));
  });
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

test('length-prefixed framing works end to end', async () => {
  const h = await startServer((msg, socket) => {
    socket.write(encodeFrame(success(msg), 'length'));
  }, 'length');
  try {
    const result = await transport(h.port, { qtechTcpFraming: 'length' }).call(event());
    assert.equal(result.kind, 'success');
    assert.equal(h.received.length, 1);
  } finally {
    h.server.close();
  }
});

test('raw framing, where the close delimits the reply, works end to end', async () => {
  const h = await startServer((msg, socket) => {
    socket.write(encodeFrame(success(msg), 'raw'));
    socket.end();
  }, 'raw');
  try {
    const result = await transport(h.port, { qtechTcpFraming: 'raw' }).call(event());
    assert.equal(result.kind, 'success');
  } finally {
    h.server.close();
  }
});

test('a reply delivered in fragments is still understood', async () => {
  // The server writes the response one byte at a time. A reader that parses
  // whatever is in the buffer fails here; an incremental one does not.
  const h = await startServer((msg, socket) => {
    const frame = encodeFrame(success(msg), 'newline');
    for (const byte of frame) socket.write(Buffer.from([byte]));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');
  } finally {
    h.server.close();
  }
});

test('a duplicate reply is reported as such', async () => {
  const h = await startServer((msg, socket) => {
    socket.write(encodeFrame(success(msg, true), 'newline'));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'success');
    assert.equal(result.kind === 'success' && result.duplicate, true);
  } finally {
    h.server.close();
  }
});

test('a business error is reported and not classed as retryable', async () => {
  for (const code of ['BRANCH_NOT_FOUND', 'COUNTER_UNKNOWN', 'VALIDATION_ERROR']) {
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

test('a refused connection is transient, so the retry policy applies', async () => {
  // Port 1 on loopback: nothing is listening.
  const result = await transport(1).call(event());
  assert.equal(result.kind, 'transient');
});

test('a silent hang times out as transient rather than blocking forever', async () => {
  const h = await startServer(() => { /* accept, never reply */ });
  try {
    const started = Date.now();
    const result = await transport(h.port, { qtechTimeoutMs: 1_000 }).call(event());
    assert.equal(result.kind, 'transient');
    assert.ok(Date.now() - started < 3_000, 'must give up on its own timeout');
  } finally {
    h.server.close();
  }
});

test('a peer that hangs up without replying is transient', async () => {
  const h = await startServer((_msg, socket) => socket.destroy());
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'transient');
  } finally {
    h.server.close();
  }
});

test('a non-JSON reply is a business error, not an endless retry', async () => {
  const h = await startServer((_msg, socket) => {
    socket.write(encodeFrame('<html>gateway</html>', 'newline'));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'business-error');
    assert.equal(result.kind === 'business-error' && result.code, 'UNPARSEABLE_RESPONSE');
  } finally {
    h.server.close();
  }
});

test('valid JSON in an unexpected shape is a business error', async () => {
  const h = await startServer((_msg, socket) => {
    socket.write(encodeFrame(JSON.stringify({ ok: true }), 'newline'));
  });
  try {
    const result = await transport(h.port).call(event());
    assert.equal(result.kind, 'business-error');
    assert.equal(result.kind === 'business-error' && result.code, 'UNEXPECTED_RESPONSE_SHAPE');
  } finally {
    h.server.close();
  }
});

test('silent is sent only when set', async () => {
  const h = await startServer((msg, socket) => {
    socket.write(encodeFrame(success(msg), 'newline'));
  });
  try {
    const t = transport(h.port);
    await t.call(event());
    await t.call(event({ silent: true, eventId: 'aaaaaaaa-1111-5111-8111-111111111111' }));
    assert.equal((JSON.parse(h.received[0]!) as Record<string, unknown>).silent, undefined);
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
    socket.on('data', () => {
      socket.write(encodeFrame(JSON.stringify({ response: 'Success', message: {} }), 'newline'));
    });
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
