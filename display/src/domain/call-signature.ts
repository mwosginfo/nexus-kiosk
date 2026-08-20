import type { KioskCallRow } from '../types.js';

/**
 * Detecting "a number was called" from the Supabase mirror.
 *
 * Nexus has TWO code paths that both land on `kiosk_checkins.status='CALLED'`,
 * and they touch different columns. Any signal that looks at only one of them
 * misses real calls:
 *
 *  Pending path — CV / DH / FRA / Accreditation (pending.service.ts)
 *    Writes through the supabase_outbox fast lane. Payload is
 *    { status, counter_number, called_at }. `call_count` and `last_called_at`
 *    are NOT mirrored, so Supabase's call_count is permanently stale here.
 *    A recall re-stamps `called_at`.
 *
 *  Legacy path — OWWA window (queue.service.ts callNext / callByNumber)
 *    Writes Supabase directly with
 *    { status, called_at, last_called_at, call_count, assigned_to, counter_number }.
 *    Its `recallEntry` moves ONLY `last_called_at` and `call_count` — `status`
 *    and `called_at` are untouched, so a called_at-only watcher is blind to
 *    every OWWA recall.
 *
 * The composite signature below covers both, plus a counter takeover (the row
 * moves to a different counter, which is a genuine re-announcement at the new
 * counter and must be forwarded).
 */
export function callSignature(row: KioskCallRow): string {
  return [
    row.called_at ?? '-',
    row.last_called_at ?? '-',
    row.call_count ?? '-',
    row.counter_number ?? '-',
  ].join('|');
}

/**
 * Tracks the last signature seen per kiosk_checkins row so a repeated read of
 * unchanged state (the reconcile poll re-reading the same rows every 15s)
 * produces no events.
 *
 * Rows are only ever *added* while CALLED, and pruned by queue date, so the
 * map stays at roughly one entry per ticket per operating day.
 */
export class CallStateCache {
  private readonly signatures = new Map<string, string>();
  private readonly dates = new Map<string, string>();

  /** Returns true when this row represents a call we have not forwarded yet. */
  isNew(row: KioskCallRow): boolean {
    if (row.status !== 'CALLED') return false;
    return this.signatures.get(row.id) !== callSignature(row);
  }

  /** Record a row's current signature without emitting anything. */
  remember(row: KioskCallRow): void {
    this.signatures.set(row.id, callSignature(row));
    if (row.queue_date) this.dates.set(row.id, row.queue_date);
  }

  has(rowId: string): boolean {
    return this.signatures.has(rowId);
  }

  get size(): number {
    return this.signatures.size;
  }

  /** Drop rows belonging to any operating day other than `keepDate`. */
  pruneToDate(keepDate: string): number {
    let removed = 0;
    for (const [id, date] of this.dates) {
      if (date !== keepDate) {
        this.dates.delete(id);
        this.signatures.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
