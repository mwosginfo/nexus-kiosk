/**
 * Payload formatting choices where we deviated from Qtech's reference client.
 *
 * Both deviations below were deliberate and defensible, and both are plausible
 * causes of a call being silently rejected. Since this protocol never reports
 * an error, the only way to find out is to eliminate them — so the defaults
 * now match `call.bat` byte for byte, and our stronger variants remain
 * available once the link is proven.
 */

/** Singapore is UTC+8 with no daylight saving, so a fixed offset is correct. */
const SGT_OFFSET_MINUTES = 8 * 60;

/**
 * `yyyy-MM-ddTHH:mm:ss+08:00` — what PowerShell's
 * `Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'` produces in their client.
 *
 * Note what it lacks: milliseconds, and a `Z`. Our earlier normalisation to
 * `toISOString()` produced `2026-09-01T03:55:33.072Z`, which is equally valid
 * ISO 8601 and equally correct as an instant, but is a different string. A
 * parser written against the layout above rather than against the standard
 * would reject it, and would have no way to tell us.
 */
export function sgtOffsetTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + SGT_OFFSET_MINUTES * 60_000);
  const iso = shifted.toISOString(); // 2026-09-01T11:55:33.072Z
  return `${iso.slice(0, 19)}+08:00`; // drop the .072Z, add the offset
}

/** Full-precision UTC instant. Unambiguous, and what we sent before. */
export function isoTimestamp(at: Date): string {
  return at.toISOString();
}

export type TimestampFormat = 'offset' | 'iso';

export function formatTimestamp(raw: string, format: TimestampFormat): string {
  const ms = Date.parse(raw);
  const at = Number.isFinite(ms) ? new Date(ms) : new Date();
  return format === 'offset' ? sgtOffsetTimestamp(at) : isoTimestamp(at);
}

export type TicketIdStyle = 'epoch' | 'uuid';

/**
 * `T` + epoch milliseconds, matching their client.
 *
 * Weaker than the UUID we were sending: two calls in the same millisecond
 * collide, and their §6 asked for an identifier unique for the operating day.
 * Per-counter serialisation makes a collision unlikely but not impossible.
 * Their client has the same weakness, so this is parity rather than a
 * regression — and if their server validates the shape, parity is what we
 * need.
 */
export function formatTicketId(uuid: string, style: TicketIdStyle, now: Date = new Date()): string {
  return style === 'uuid' ? uuid : `T${now.getTime()}`;
}
