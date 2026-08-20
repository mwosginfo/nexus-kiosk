import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from '../src/config.js';

const base = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseKey: 'k',
  qtechUsername: 'u',
  qtechPassword: 'p',
  qtechBranchUuid: 'c761bfe7',
};

test('a plain-HTTP Qtech endpoint is rejected', () => {
  // Qtech §3: "HTTPS only, TLS 1.2 or higher. Plain HTTP is not offered."
  // A mistyped scheme would otherwise ship the Basic secret in cleartext, and
  // the only symptom would be that it appeared to work.
  assert.throws(() =>
    ConfigSchema.parse({ ...base, qtechBaseUrl: 'http://tenant.qtechqms.com/api/v1/ops' }),
  );
});

test('https is accepted', () => {
  const config = ConfigSchema.parse({
    ...base,
    qtechBaseUrl: 'https://tenant.qtechqms.com/api/v1/ops',
  });
  assert.equal(config.qtechBaseUrl, 'https://tenant.qtechqms.com/api/v1/ops');
});

test('loopback http is allowed so the delivery tests can use a local stub', () => {
  for (const url of [
    'http://127.0.0.1:8080/api/v1/ops',
    'http://localhost:8080/api/v1/ops',
  ]) {
    assert.doesNotThrow(() => ConfigSchema.parse({ ...base, qtechBaseUrl: url }));
  }
});

test('a non-loopback host that merely looks local is still rejected', () => {
  assert.throws(() =>
    ConfigSchema.parse({ ...base, qtechBaseUrl: 'http://localhost.evil.com/api/v1/ops' }),
  );
});

test('a non-HTTP scheme is rejected', () => {
  assert.throws(() => ConfigSchema.parse({ ...base, qtechBaseUrl: 'ftp://tenant.example.com' }));
});
