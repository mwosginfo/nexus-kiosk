import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from '../src/config.js';
import { formatCounterName, isCounterAllowed } from '../src/domain/counter.js';

const base = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseKey: 'k',
  qtechBaseUrl: 'https://tenant.qtechqms.com/api/v1/ops',
  qtechUsername: 'u',
  qtechPassword: 'p',
  qtechBranchUuid: 'c761bfe7',
};

test('numeric counter names are the default, because Qtech voice is pre-recorded', () => {
  const config = ConfigSchema.parse(base);
  assert.equal(formatCounterName(7, config), '7');
});

test('the prefixed form is also numeric-announceable', () => {
  const config = ConfigSchema.parse({ ...base, counterNameFormat: 'prefixed' });
  assert.equal(formatCounterName(7, config), 'Counter 7');
});

test('counters outside the agreed list are rejected locally, not by Qtech', () => {
  const config = ConfigSchema.parse(base);
  assert.equal(isCounterAllowed(7, config), true);
  assert.equal(isCounterAllowed(10, config), true);
  assert.equal(isCounterAllowed(11, config), false);
});

test('the agreed counter list is configurable without a code change', () => {
  const config = ConfigSchema.parse({ ...base, allowedCounters: '1, 2, 5' });
  assert.deepEqual(config.allowedCounters, [1, 2, 5]);
  assert.equal(isCounterAllowed(5, config), true);
  assert.equal(isCounterAllowed(3, config), false);
});

test('config rejects a malformed counter list rather than silently emptying it', () => {
  assert.throws(() => ConfigSchema.parse({ ...base, allowedCounters: 'seven' }));
});

test('config parses both the env-string and boolean forms of a flag', () => {
  // Config must be a valid input to its own schema — the env supplies strings,
  // callers supply booleans, and both have to land on the same value.
  assert.equal(ConfigSchema.parse({ ...base, dryRun: 'true' }).dryRun, true);
  assert.equal(ConfigSchema.parse({ ...base, dryRun: '1' }).dryRun, true);
  assert.equal(ConfigSchema.parse({ ...base, dryRun: false }).dryRun, false);
  assert.equal(ConfigSchema.parse(base).dryRun, false);
  assert.equal(ConfigSchema.parse(base).resyncOnStart, true);
});
