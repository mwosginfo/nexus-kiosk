import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQueueNo, resolveQueueNo } from '../src/domain/queue-no.js';

test('renders every Nexus queue series the way staff see it', () => {
  assert.equal(formatQueueNo(6001, 'REGULAR'), '6001');
  assert.equal(formatQueueNo(9011, 'OWWA'), '9011');
  assert.equal(formatQueueNo(4, 'FRA'), 'A004');
  assert.equal(formatQueueNo(601, 'WALKIN_REGULAR'), 'W601');
  assert.equal(formatQueueNo(901, 'WALKIN_OWWA'), 'W901');
  assert.equal(formatQueueNo(1, 'WALKIN_FRA'), 'WA01');
});

test('an unknown series falls back to the bare number rather than throwing', () => {
  assert.equal(formatQueueNo(1234, 'SOMETHING_NEW'), '1234');
  assert.equal(formatQueueNo(1234, null), '1234');
});

test('display_number wins when present', () => {
  assert.equal(resolveQueueNo('A004', 4, 'FRA'), 'A004');
  assert.equal(resolveQueueNo('  6001  ', 9999, 'REGULAR'), '6001');
});

test('falls back to formatting when display_number is absent or blank', () => {
  assert.equal(resolveQueueNo(null, 4, 'FRA'), 'A004');
  assert.equal(resolveQueueNo('', 6001, 'REGULAR'), '6001');
  assert.equal(resolveQueueNo('   ', 6001, 'REGULAR'), '6001');
});

test('returns null when there is nothing to display', () => {
  assert.equal(resolveQueueNo(null, null, 'REGULAR'), null);
});
