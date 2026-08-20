import type { Config } from '../config.js';

/**
 * `counter_number` → Qtech `counterName`.
 *
 * Two constraints from the Qtech integration response drive this:
 *  - §2: voice announcements are pre-recorded, so only numeric counter names
 *    can be announced. "7" and "Counter 7" both qualify; "Window A" does not.
 *  - item 7.4: the names must match the list agreed at setup, and Qtech must
 *    be notified before a new one is introduced.
 *
 * We validate against the agreed list locally instead of letting Qtech reject
 * it as COUNTER_UNKNOWN, so the failure is visible on our side with a useful
 * reason and no wasted round-trip.
 */
export function formatCounterName(counterNumber: number, config: Config): string {
  switch (config.counterNameFormat) {
    case 'prefixed':
      return `Counter ${counterNumber}`;
    case 'number':
      return String(counterNumber);
  }
}

export function isCounterAllowed(counterNumber: number, config: Config): boolean {
  return config.allowedCounters.includes(counterNumber);
}
