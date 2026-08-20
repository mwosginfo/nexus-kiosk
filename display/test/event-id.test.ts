import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveEventId, deriveResyncEventId } from '../src/domain/event-id.js';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TICKET = '11111111-1111-4111-8111-111111111111';

test('eventId is a well-formed v5 UUID', () => {
  assert.match(deriveEventId(TICKET, 'sig'), UUID_V5);
});

test('the same call always derives the same eventId', () => {
  // This is what makes a retry safe: Qtech suppresses a repeated eventId
  // inside 10 minutes, so a retry must not invent a new key. Deriving it
  // rather than generating it also survives a process restart mid-retry.
  const a = deriveEventId(TICKET, '2026-08-20T01:00:00Z|-|-|7');
  const b = deriveEventId(TICKET, '2026-08-20T01:00:00Z|-|-|7');
  assert.equal(a, b);
});

test('a recall derives a different eventId so Qtech re-announces', () => {
  const first = deriveEventId(TICKET, '2026-08-20T01:00:00Z|-|-|7');
  const recall = deriveEventId(TICKET, '2026-08-20T01:05:00Z|-|-|7');
  assert.notEqual(first, recall);
});

test('different tickets never collide on the same signature', () => {
  const a = deriveEventId('11111111-1111-4111-8111-111111111111', 'sig');
  const b = deriveEventId('22222222-2222-4222-8222-222222222222', 'sig');
  assert.notEqual(a, b);
});

test('a resync key differs from the live key it re-asserts', () => {
  // Otherwise the resync would land inside Qtech's duplicate window, be
  // suppressed, and leave the wall showing the stale value it was meant to fix.
  const live = deriveEventId(TICKET, 'sig');
  const resync = deriveResyncEventId('boot-1', TICKET, 'sig');
  assert.notEqual(live, resync);
  assert.match(resync, UUID_V5);
});

test('each boot produces a fresh resync key', () => {
  assert.notEqual(
    deriveResyncEventId('boot-1', TICKET, 'sig'),
    deriveResyncEventId('boot-2', TICKET, 'sig'),
  );
});
