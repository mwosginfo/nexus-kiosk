/**
 * Format a queue number for display on the thermal ticket.
 *
 * Regular: 6001, 6002...
 * OWWA: 9001, 9002...
 * FRA: A001, A002... (A prefix + zero-padded 3 digits)
 * Walk-in Regular: W601, W602...
 * Walk-in OWWA: W901, W902...
 * Walk-in FRA: WA01, WA02...
 */
export function formatQueueNumber(
  queueNumber: number,
  queueSeries: string,
  displayNumber?: string
): string {
  // If Nexus already provides a displayNumber (e.g. for FRA), use it
  if (displayNumber) return displayNumber;

  switch (queueSeries) {
    case 'FRA':
      return `A${String(queueNumber).padStart(3, '0')}`;
    case 'WALKIN_REGULAR':
      return `W${queueNumber}`;
    case 'WALKIN_OWWA':
      return `W${queueNumber}`;
    case 'WALKIN_FRA':
      return `WA${String(queueNumber).padStart(2, '0')}`;
    default:
      return String(queueNumber);
  }
}
