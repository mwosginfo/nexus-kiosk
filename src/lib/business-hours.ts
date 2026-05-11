/**
 * Business-hours rules for kiosk operations.
 *
 * Time is always evaluated in Singapore Time (UTC+8) per CLAUDE.md §5.1 —
 * never trust the system clock's timezone, only its UTC reading.
 */

function nowSGT(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

/**
 * FRA / Employment Agency check-in is open from 09:00 SGT until 12:00 SGT.
 * After noon the kiosk still shows the FRA tile but redirects to a cutoff
 * message — agencies must resubmit the next working day.
 */
export function isFraCheckinOpen(): boolean {
  const sgt = nowSGT();
  return sgt.getUTCHours() < 12;
}

export const FRA_CUTOFF_MESSAGE =
  'Cut off of submission for Contract at 12PM. ' +
  'You may resubmit the next working day, between 9AM and 12PM.';
