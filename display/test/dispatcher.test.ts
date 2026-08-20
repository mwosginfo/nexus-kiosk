import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigSchema, type Config } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { QtechClient } from '../src/qtech/client.js';
import { Dispatcher } from '../src/dispatch/dispatcher.js';
import type { CallLogEntry, HealthSink } from '../src/supabase/health-writer.js';
import type { CallEvent } from '../src/types.js';

/**
 * End-to-end delivery tests against a real HTTP server standing in for Qtech.
 * These cover the behaviours their integration response §4 makes mandatory:
 * retry only on transient faults, never on business errors, and one
 * idempotency key reused across the retries of a single call.
 */

interface Captured {
  readonly headers: IncomingMessage['headers'];
  readonly body: Record<string, unknown>;
}

interface Harness {
  readonly server: Server;
  readonly requests: Captured[];
  readonly url: string;
}

async function startQtechStub(
  handler: (req: Captured, res: ServerResponse, index: number) => void,
): Promise<Harness> {
  const requests: Captured[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const captured: Captured = {
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      requests.push(captured);
      handler(captured, res, requests.length - 1);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, requests, url: `http://127.0.0.1:${port}` };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

function success(eventId: string, duplicate = false): unknown {
  return {
    response: 'Success',
    message: {
      eventId,
      ticketID: 't',
      queueNo: 'A045',
      counterName: '7',
      status: 'ON_CALL',
      serverTime: '2026-08-20T09:14:22.481+08:00',
      duplicate,
    },
  };
}

function makeConfig(baseUrl: string, over: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'k',
    qtechBaseUrl: baseUrl,
    qtechUsername: 'mwo',
    qtechPassword: 's3cret',
    qtechBranchUuid: 'c761bfe7',
    qtechTimeoutMs: 2_000,
    ...over,
  });
}

class RecordingSink implements HealthSink {
  readonly entries: CallLogEntry[] = [];
  noteOutcome(entry: CallLogEntry): void {
    this.entries.push(entry);
  }
  writeLog(): Promise<void> {
    return Promise.resolve();
  }
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

function build(harness: Harness, over: Partial<Config> = {}): {
  dispatcher: Dispatcher;
  sink: RecordingSink;
} {
  const config = makeConfig(harness.url, over);
  const logger = createLogger({ logLevel: 'error', bridgeId: 'test' });
  const sink = new RecordingSink();
  const dispatcher = new Dispatcher(
    new QtechClient(config, logger),
    sink,
    logger,
    new AbortController().signal,
  );
  return { dispatcher, sink };
}

test('a successful call is sent once with the documented payload', async () => {
  const harness = await startQtechStub((req, res) => {
    json(res, 200, success(String(req.body.eventId)));
  });
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();

    assert.equal(harness.requests.length, 1);
    const sent = harness.requests[0]!;
    assert.deepEqual(sent.body, {
      eventId: 'b3f1c2e0-1111-5111-8111-111111111111',
      ticketID: '11111111-1111-4111-8111-111111111111',
      branchUUID: 'c761bfe7',
      counterName: '7',
      queueNo: 'A045',
      timestamp: '2026-08-20T09:14:22+08:00',
    });
    assert.equal(
      sent.headers.authorization,
      `Basic ${Buffer.from('mwo:s3cret').toString('base64')}`,
    );
    assert.equal(sink.entries.at(-1)?.outcome, 'SENT');
  } finally {
    harness.server.close();
  }
});

test('no personal data leaves the bridge', async () => {
  const harness = await startQtechStub((req, res) => {
    json(res, 200, success(String(req.body.eventId)));
  });
  try {
    const { dispatcher } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();

    // Qtech §6: no name, email, passport or OFW number is wanted, and the
    // ticket id must be opaque. The payload keys are a closed set.
    const keys = Object.keys(harness.requests[0]!.body).sort();
    assert.deepEqual(keys, [
      'branchUUID',
      'counterName',
      'eventId',
      'queueNo',
      'ticketID',
      'timestamp',
    ]);
  } finally {
    harness.server.close();
  }
});

test('silent is only sent when the bridge means it', async () => {
  const harness = await startQtechStub((req, res) => {
    json(res, 200, success(String(req.body.eventId)));
  });
  try {
    const { dispatcher } = build(harness);
    dispatcher.submit({ kind: 'send', event: event({ silent: true }) });
    await dispatcher.drain();
    assert.equal(harness.requests[0]!.body.silent, true);
  } finally {
    harness.server.close();
  }
});

test('a 500 is retried, and every attempt reuses the same eventId', async () => {
  const harness = await startQtechStub((req, res, index) => {
    if (index < 2) {
      json(res, 500, { response: 'Error', message: 'upstream' });
      return;
    }
    json(res, 200, success(String(req.body.eventId)));
  });
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();

    assert.equal(harness.requests.length, 3);
    const ids = new Set(harness.requests.map((r) => String(r.body.eventId)));
    assert.equal(ids.size, 1, 'a retry must not regenerate the idempotency key');
    assert.equal(sink.entries.at(-1)?.outcome, 'SENT');
    assert.equal(sink.entries.at(-1)?.attempts, 3);
  } finally {
    harness.server.close();
  }
});

test('a 429 is retried', async () => {
  const harness = await startQtechStub((req, res, index) => {
    if (index === 0) {
      json(res, 429, { response: 'Error' });
      return;
    }
    json(res, 200, success(String(req.body.eventId)));
  });
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();
    assert.equal(harness.requests.length, 2);
    assert.equal(sink.entries.at(-1)?.outcome, 'SENT');
  } finally {
    harness.server.close();
  }
});

test('a business error is never retried', async () => {
  // §4: "Do not retry on a business error — the outcome will not change on
  // repeat." Retrying COUNTER_UNKNOWN forever is the failure this prevents.
  for (const code of ['BRANCH_NOT_FOUND', 'COUNTER_UNKNOWN', 'VALIDATION_ERROR']) {
    const harness = await startQtechStub((_req, res) => {
      json(res, 200, { response: 'Error', code });
    });
    try {
      const { dispatcher, sink } = build(harness);
      dispatcher.submit({ kind: 'send', event: event() });
      await dispatcher.drain();

      assert.equal(harness.requests.length, 1, code);
      assert.equal(sink.entries.at(-1)?.outcome, 'FAILED', code);
      assert.equal(sink.entries.at(-1)?.qtechCode, code);
    } finally {
      harness.server.close();
    }
  }
});

test('a rejected credential is not retried and is reported as AUTH_FAILED', async () => {
  const harness = await startQtechStub((_req, res) => {
    json(res, 401, { response: 'Error' });
  });
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();
    assert.equal(harness.requests.length, 1);
    assert.equal(sink.entries.at(-1)?.qtechCode, 'AUTH_FAILED');
  } finally {
    harness.server.close();
  }
});

test('a duplicate response is recorded as such, not as a failure', async () => {
  const harness = await startQtechStub((req, res) => {
    json(res, 200, success(String(req.body.eventId), true));
  });
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();
    assert.equal(sink.entries.at(-1)?.outcome, 'DUPLICATE');
  } finally {
    harness.server.close();
  }
});

test('a call that never succeeds gives up after the final retry and says so', async () => {
  const harness = await startQtechStub((_req, res) => {
    json(res, 503, { response: 'Error' });
  });
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();

    assert.equal(harness.requests.length, 3);
    const last = sink.entries.at(-1);
    assert.equal(last?.outcome, 'FAILED');
    assert.equal(last?.qtechCode, 'RETRIES_EXHAUSTED');
  } finally {
    harness.server.close();
  }
});

test('calls to one counter reach Qtech in order', async () => {
  const harness = await startQtechStub((req, res, index) => {
    // Delay the first response so an unserialised second call would overtake it.
    const delay = index === 0 ? 40 : 0;
    setTimeout(() => json(res, 200, success(String(req.body.eventId))), delay);
  });
  try {
    const { dispatcher } = build(harness);
    dispatcher.submit({ kind: 'send', event: event({ eventId: 'aaaaaaaa-1111-5111-8111-111111111111', queueNo: '6001' }) });
    dispatcher.submit({ kind: 'send', event: event({ eventId: 'bbbbbbbb-1111-5111-8111-111111111111', queueNo: '6002' }) });
    await dispatcher.drain();

    assert.deepEqual(
      harness.requests.map((r) => r.body.queueNo),
      ['6001', '6002'],
    );
  } finally {
    harness.server.close();
  }
});

test('a blocked call is recorded and never reaches Qtech', async () => {
  const harness = await startQtechStub((_req, res) => json(res, 200, success('x')));
  try {
    const { dispatcher, sink } = build(harness);
    dispatcher.submit({
      kind: 'blocked',
      blocked: {
        ticketId: '11111111-1111-4111-8111-111111111111',
        queueNo: '6001',
        reason: 'COUNTER_MISSING',
        detail: 'called with no counter assigned',
        signature: 'sig',
      },
    });
    await dispatcher.drain();

    assert.equal(harness.requests.length, 0);
    assert.equal(sink.entries.at(-1)?.outcome, 'BLOCKED');
    assert.equal(sink.entries.at(-1)?.qtechCode, 'COUNTER_MISSING');
  } finally {
    harness.server.close();
  }
});

test('dry run performs no outbound call but still records the outcome', async () => {
  const harness = await startQtechStub((_req, res) => json(res, 200, success('x')));
  try {
    const { dispatcher, sink } = build(harness, { dryRun: true });
    dispatcher.submit({ kind: 'send', event: event() });
    await dispatcher.drain();
    assert.equal(harness.requests.length, 0);
    assert.equal(sink.entries.at(-1)?.outcome, 'SENT');
  } finally {
    harness.server.close();
  }
});
