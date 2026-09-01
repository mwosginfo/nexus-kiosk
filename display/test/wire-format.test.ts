import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTicketId, formatTimestamp, sgtOffsetTimestamp } from '../src/qtech/wire-format.js';

test('the offset timestamp matches what their client produces', () => {
  // PowerShell: Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz' in SGT.
  // No milliseconds, no Z, explicit +08:00.
  const at = new Date('2026-09-01T03:55:33.072Z');
  assert.equal(sgtOffsetTimestamp(at), '2026-09-01T11:55:33+08:00');
});

test('the offset form carries no milliseconds and no Z', () => {
  const out = sgtOffsetTimestamp(new Date('2026-01-05T16:04:09.999Z'));
  assert.equal(out, '2026-01-06T00:04:09+08:00');
  assert.ok(!out.includes('.'), 'no milliseconds');
  assert.ok(!out.endsWith('Z'), 'no Z suffix');
});

test('both formats describe the same instant', () => {
  const at = new Date('2026-09-01T03:55:33.072Z');
  assert.equal(
    Date.parse(formatTimestamp(at.toISOString(), 'offset')),
    Date.parse('2026-09-01T03:55:33Z'),
  );
  assert.equal(Date.parse(formatTimestamp(at.toISOString(), 'iso')), at.getTime());
});

test('an unparseable timestamp falls back to now rather than being forwarded', () => {
  const out = formatTimestamp('not a date', 'offset');
  assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
});

test('the epoch ticket id matches their shape', () => {
  const id = formatTicketId('545a335d-8c8f-4941-8158-329e70f093a1', 'epoch', new Date(1756713333072));
  assert.equal(id, 'T1756713333072');
});

test('the uuid style passes the check-in id through unchanged', () => {
  const uuid = '545a335d-8c8f-4941-8158-329e70f093a1';
  assert.equal(formatTicketId(uuid, 'uuid'), uuid);
});
