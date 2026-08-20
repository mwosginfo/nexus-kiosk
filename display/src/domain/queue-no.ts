/**
 * Queue-number rendering.
 *
 * `kiosk_checkins.display_number` is written at check-in and is authoritative
 * when present. The fallback mirrors Nexus's own formatter so a row that
 * predates the column (or a walk-in written by an older client) still renders
 * identically to what staff see on the Nexus side.
 *
 * Qtech displays `queueNo` verbatim (their §6: series is already carried in
 * the number itself, e.g. the `A` in `A045`).
 */
export function formatQueueNo(
  queueNumber: number | null,
  queueSeries: string | null,
): string | null {
  if (queueNumber === null) return null;
  switch (queueSeries) {
    case 'FRA':
      return `A${String(queueNumber).padStart(3, '0')}`;
    case 'WALKIN_FRA':
      return `WA${String(queueNumber).padStart(2, '0')}`;
    case 'WALKIN_REGULAR':
    case 'WALKIN_OWWA':
      return `W${queueNumber}`;
    default:
      // REGULAR (6000-series) and OWWA (9000-series) render as the bare number.
      return String(queueNumber);
  }
}

export function resolveQueueNo(
  displayNumber: string | null,
  queueNumber: number | null,
  queueSeries: string | null,
): string | null {
  const trimmed = displayNumber?.trim();
  if (trimmed) return trimmed;
  return formatQueueNo(queueNumber, queueSeries);
}
