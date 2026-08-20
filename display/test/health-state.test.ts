import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthWriter, type CallLogEntry } from '../src/supabase/health-writer.js';
import { ConfigSchema } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The health row is the only channel through which Nexus learns the bridge has
 * failed, so what does and does not move `consecutive_failures` is the whole
 * contract. These assert against the private state via the upsert payload.
 */

interface Upserted {
  readonly consecutive_failures: number;
  readonly blocked_today: number;
  readonly failed_today: number;
  readonly sent_today: number;
  readonly last_error_code: string | null;
}

function harness(): { writer: HealthWriter; rows: Upserted[] } {
  const rows: Upserted[] = [];
  const stub = {
    from: () => ({
      upsert: (payload: Upserted) => {
        rows.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;

  const config = ConfigSchema.parse({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'k',
    qtechBaseUrl: 'https://tenant.qtechqms.com/api/v1/ops',
    qtechUsername: 'u',
    qtechPassword: 'p',
    qtechBranchUuid: 'b',
  });
  const writer = new HealthWriter(
    stub,
    config,
    createLogger({ logLevel: 'error', bridgeId: 'test' }),
    'test',
  );
  return { writer, rows };
}

function entry(over: Partial<CallLogEntry>): CallLogEntry {
  return {
    eventId: 'b3f1c2e0-1111-5111-8111-111111111111',
    ticketId: 't',
    queueNo: '6001',
    counterName: '7',
    outcome: 'SENT',
    attempts: 1,
    httpStatus: 200,
    qtechCode: null,
    errorMessage: null,
    latencyMs: 5,
    silent: false,
    ...over,
  };
}

test('a blocked call counts toward the failure streak', async () => {
  // Otherwise a systemic problem — nobody assigning counters — leaves every
  // call blocked while the health view still reports OK, and staff have no
  // signal that the wall has gone dark.
  const { writer, rows } = harness();
  for (let i = 0; i < 3; i++) {
    writer.noteOutcome(entry({ outcome: 'BLOCKED', qtechCode: 'COUNTER_MISSING' }));
  }
  await writer.flush();

  const last = rows.at(-1)!;
  assert.equal(last.blocked_today, 3);
  assert.equal(last.consecutive_failures, 3, 'three blocked calls should reach the DEGRADED threshold');
  assert.equal(last.last_error_code, 'COUNTER_MISSING', 'cause stays distinguishable from a delivery failure');
});

test('a success clears the streak', async () => {
  const { writer, rows } = harness();
  writer.noteOutcome(entry({ outcome: 'FAILED', qtechCode: 'RETRIES_EXHAUSTED' }));
  writer.noteOutcome(entry({ outcome: 'BLOCKED', qtechCode: 'COUNTER_MISSING' }));
  writer.noteOutcome(entry({ outcome: 'SENT' }));
  await writer.flush();

  const last = rows.at(-1)!;
  assert.equal(last.consecutive_failures, 0);
  assert.equal(last.sent_today, 1);
  assert.equal(last.failed_today, 1);
  assert.equal(last.blocked_today, 1);
});

test('a duplicate is treated as delivered, not as a failure', async () => {
  // Qtech returns duplicate:true for a retry it suppressed. The call did land.
  const { writer, rows } = harness();
  writer.noteOutcome(entry({ outcome: 'FAILED', qtechCode: 'RETRIES_EXHAUSTED' }));
  writer.noteOutcome(entry({ outcome: 'DUPLICATE' }));
  await writer.flush();
  assert.equal(rows.at(-1)!.consecutive_failures, 0);
});
