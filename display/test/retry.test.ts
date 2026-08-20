import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, delayBeforeAttempt } from '../src/dispatch/retry.js';

test('follows the backoff Qtech asked for: immediate, 1s, 2s, capped at 3 attempts', () => {
  assert.equal(delayBeforeAttempt(1), 0);
  assert.equal(delayBeforeAttempt(2), 1_000);
  assert.equal(delayBeforeAttempt(3), 2_000);
  assert.equal(MAX_ATTEMPTS, 3);
});

test('the table carries the documented 4s step for a raised cap', () => {
  assert.equal(delayBeforeAttempt(4), 4_000);
  // Beyond the table, hold at the last step rather than growing unbounded.
  assert.equal(delayBeforeAttempt(9), 4_000);
});
