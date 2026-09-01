import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from '../src/config.js';

const base = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseKey: 'k',
  qtechAuthToken: 'QT-MWO-testtoken',
  qtechBaseUrl: 'http://192.168.1.50:9100',
  qtechBranchUuid: 'c761bfe7',
};

// ── Qtech leg — on-premises, plaintext by design since 2026-08-20 ──────────

test('plaintext to a private address is accepted', () => {
  // Qtech dropped TLS on the grounds that the link never leaves the building.
  for (const url of [
    'http://192.168.1.50:9100',
    'http://10.0.5.20:9100',
    'http://172.16.4.9:9100',
    'http://172.31.255.1:9100',
    'http://qtech-display:9100',
    'http://qtech.local:9100',
    'http://127.0.0.1:8080/api/v1/ops',
  ]) {
    assert.doesNotThrow(() => ConfigSchema.parse({ ...base, qtechBaseUrl: url }), url);
  }
});

test('plaintext to a PUBLIC address is still rejected', () => {
  // Their justification is that the traffic stays on the premises. A public
  // host means it does not, and the justification does not travel with it.
  for (const url of [
    'http://tenant.qtechqms.com/api/v1/ops',
    'http://203.0.113.10:9100',
    'http://172.32.0.1:9100',    // just outside the RFC 1918 range
    'http://8.8.8.8:9100',
  ]) {
    assert.throws(() => ConfigSchema.parse({ ...base, qtechBaseUrl: url }), `expected rejection: ${url}`);
  }
});

test('TLS to a public Qtech host remains acceptable', () => {
  assert.doesNotThrow(() =>
    ConfigSchema.parse({ ...base, qtechBaseUrl: 'https://tenant.qtechqms.com/api/v1/ops' }),
  );
});

test('Qtech credentials are optional now that the protocol carries no auth', () => {
  const config = ConfigSchema.parse(base);
  assert.equal(config.qtechUsername, undefined);
  assert.equal(config.qtechPassword, undefined);
});

// ── Supabase leg — the only remaining security boundary ────────────────────

test('a plain-HTTP Supabase URL is rejected', () => {
  // This leg crosses the internet and carries the service key. With Qtech now
  // plaintext on the LAN, it is the whole of the bridge's attack surface.
  assert.throws(() =>
    ConfigSchema.parse({ ...base, supabaseUrl: 'http://example.supabase.co' }),
  );
});

test('a private-address Supabase URL is still rejected without TLS', () => {
  // The Qtech exemption must not leak across to the leg that holds the secret.
  assert.throws(() =>
    ConfigSchema.parse({ ...base, supabaseUrl: 'http://192.168.1.10:8000' }),
  );
});

test('loopback Supabase is allowed so the tests can use a local stub', () => {
  assert.doesNotThrow(() =>
    ConfigSchema.parse({ ...base, supabaseUrl: 'http://127.0.0.1:54321' }),
  );
});

test('a non-HTTP scheme is rejected on both legs', () => {
  assert.throws(() => ConfigSchema.parse({ ...base, qtechBaseUrl: 'ftp://qtech.local' }));
  assert.throws(() => ConfigSchema.parse({ ...base, supabaseUrl: 'ftp://example.com' }));
});

// ── The auth token ─────────────────────────────────────────────────────────

test('the TCP transport refuses to start without an auth token', () => {
  // This protocol never replies. A missing or wrong token would have Qtech
  // rejecting every call with no error anywhere: the health row would read OK
  // and the wall would sit blank. Startup is the only place it can be caught,
  // so a placeholder default is worse than useless here.
  const { qtechAuthToken: _omitted, ...noToken } = base;
  assert.throws(
    () => ConfigSchema.parse(noToken),
    /QTECH_AUTH_TOKEN is required/,
  );
});

test('an empty auth token is rejected too', () => {
  assert.throws(() => ConfigSchema.parse({ ...base, qtechAuthToken: '' }));
});

test('the HTTP fallback does not require the TCP token', () => {
  const { qtechAuthToken: _omitted, ...noToken } = base;
  assert.doesNotThrow(() =>
    ConfigSchema.parse({
      ...noToken,
      qtechTransport: 'http',
      qtechBaseUrl: 'https://tenant.qtechqms.com/api/v1/ops',
    }),
  );
});

test('an unreplaced template placeholder is rejected', () => {
  // systemd's EnvironmentFile parser is not a shell: it reads
  // QTECH_AUTH_TOKEN=<token from Qtech> as that literal string, which is
  // non-empty and passes a min(1) check. The bridge then starts, sends a
  // garbage token, Qtech rejects every call silently, and the wall stays
  // blank with the health row reading OK. This happened.
  for (const placeholder of [
    '<token from Qtech>',
    '<your-token-here>',
    'changeme',
    'unset',
    'QT MWO abc',      // spaces: no real token has them
  ]) {
    assert.throws(
      () => ConfigSchema.parse({ ...base, qtechAuthToken: placeholder }),
      /placeholder/i,
      placeholder,
    );
  }
});

test('a real token is accepted', () => {
  assert.doesNotThrow(() =>
    ConfigSchema.parse({ ...base, qtechAuthToken: 'QT-MWO-3b641f1c7b7284aa32c95673d5465d7c' }),
  );
});
