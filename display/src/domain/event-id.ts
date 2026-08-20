import { uuidV5 } from './uuid5.js';

/**
 * Fixed namespace for this integration. Any constant UUID works; it only has
 * to stay stable, because changing it changes every derived eventId and would
 * make in-flight retries look like new events to Qtech.
 */
const NAMESPACE = '6f1c2a54-9b3d-5e7a-8c41-2d9e7b6a4f10';

/**
 * eventId for a live call.
 *
 * Derived from (ticket, call signature) rather than randomly generated, which
 * gives us Qtech's item 7.5 requirement for free: "one UUID per call, reused
 * across retries of that same call rather than regenerated per attempt".
 * Because the derivation is pure, it survives a process restart mid-retry —
 * a randomly-generated key would not.
 *
 * A deliberate recall changes the signature (a re-stamped called_at, or a
 * bumped call_count on the legacy path), so it yields a different eventId and
 * Qtech re-announces, exactly as their §4 requires.
 */
export function deriveEventId(ticketId: string, signature: string): string {
  return uuidV5(`call:${ticketId}:${signature}`, NAMESPACE);
}

/**
 * eventId for a boot resync.
 *
 * Salted with the boot id so a restart always produces a fresh key rather than
 * colliding with the original call's key inside Qtech's 10-minute duplicate
 * window — a duplicate is suppressed and would leave the wall stale, which is
 * the exact thing the resync exists to fix. Sent with `silent: true`.
 */
export function deriveResyncEventId(
  bootId: string,
  ticketId: string,
  signature: string,
): string {
  return uuidV5(`resync:${bootId}:${ticketId}:${signature}`, NAMESPACE);
}
