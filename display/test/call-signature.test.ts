import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallStateCache, callSignature } from '../src/domain/call-signature.js';
import type { KioskCallRow } from '../src/types.js';

function row(over: Partial<KioskCallRow> = {}): KioskCallRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'CALLED',
    queue_number: 6001,
    display_number: '6001',
    queue_series: 'REGULAR',
    counter_number: 7,
    called_at: '2026-08-20T01:00:00.000Z',
    last_called_at: null,
    call_count: null,
    queue_date: '2026-08-20',
    ...over,
  };
}

test('a first call is new', () => {
  const cache = new CallStateCache();
  assert.equal(cache.isNew(row()), true);
});

test('re-reading unchanged state produces no second event', () => {
  const cache = new CallStateCache();
  const r = row();
  cache.remember(r);
  assert.equal(cache.isNew(r), false);
  // The reconcile poll re-reads the same row every 15s; it must stay quiet.
  assert.equal(cache.isNew(row()), false);
});

test('pending-path recall is detected via a re-stamped called_at', () => {
  // CV / DH / FRA / ACC go through the outbox, which writes
  // { status, counter_number, called_at } and never touches call_count.
  const cache = new CallStateCache();
  cache.remember(row());
  assert.equal(cache.isNew(row({ called_at: '2026-08-20T01:05:00.000Z' })), true);
});

test('legacy OWWA recall is detected even though called_at never moves', () => {
  // queue.service.ts recallEntry writes ONLY last_called_at + call_count.
  // A called_at-only watcher is blind to every OWWA recall — this is the
  // regression this test exists to prevent.
  const cache = new CallStateCache();
  const first = row({ last_called_at: '2026-08-20T01:00:00.000Z', call_count: 1 });
  cache.remember(first);

  const recalled = row({ last_called_at: '2026-08-20T01:06:00.000Z', call_count: 2 });
  assert.equal(recalled.called_at, first.called_at, 'precondition: called_at unchanged');
  assert.equal(cache.isNew(recalled), true);
});

test('a counter takeover re-announces at the new counter', () => {
  const cache = new CallStateCache();
  cache.remember(row());
  assert.equal(cache.isNew(row({ counter_number: 3 })), true);
});

test('non-CALLED rows never produce events', () => {
  const cache = new CallStateCache();
  for (const status of ['WAITING', 'PROCESSING', 'SUBMITTED', 'PROCESSED', 'RECEIVED', 'MISSED']) {
    assert.equal(cache.isNew(row({ status })), false, status);
  }
});

test('progressing past CALLED does not re-emit when the row settles', () => {
  const cache = new CallStateCache();
  const called = row();
  cache.remember(called);
  assert.equal(cache.isNew(row({ status: 'PROCESSING' })), false);
  // And if it somehow reappears as CALLED with identical call fields, still quiet.
  assert.equal(cache.isNew(called), false);
});

test('signature is stable and order-independent of null handling', () => {
  assert.equal(callSignature(row()), callSignature(row()));
  assert.notEqual(callSignature(row()), callSignature(row({ counter_number: 8 })));
});

test('cache prunes rows from other operating days', () => {
  const cache = new CallStateCache();
  cache.remember(row({ id: 'a', queue_date: '2026-08-19' }));
  cache.remember(row({ id: 'b', queue_date: '2026-08-20' }));
  assert.equal(cache.size, 2);
  assert.equal(cache.pruneToDate('2026-08-20'), 1);
  assert.equal(cache.size, 1);
  assert.equal(cache.has('b'), true);
});
