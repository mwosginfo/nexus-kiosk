import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { safeError } from '../logger.js';
import {
  KIOSK_CALL_COLUMNS,
  KioskCallRowSchema,
  type CallCandidate,
  type KioskCallRow,
} from '../types.js';
import { CallStateCache, callSignature } from '../domain/call-signature.js';
import { deriveEventId, deriveResyncEventId } from '../domain/event-id.js';
import { resolveQueueNo } from '../domain/queue-no.js';
import { formatCounterName, isCounterAllowed } from '../domain/counter.js';
import { sgtToday } from './client.js';

export type CandidateSource = 'realtime' | 'poll' | 'resync';

export interface WatcherHandlers {
  readonly onCandidate: (candidate: CallCandidate, source: CandidateSource) => void;
  readonly onRealtimeState: (connected: boolean) => void;
  readonly onRealtimeEvent: () => void;
  readonly onReconcile: () => void;
}

/**
 * Turns `kiosk_checkins` state changes into discrete call events.
 *
 * Two inputs, deliberately overlapping:
 *
 *   Realtime  — primary. Sub-second, push. Can die silently: the socket stays
 *               open and simply stops delivering. Nothing errors.
 *   Reconcile — safety net. Re-reads today's CALLED rows on a timer and diffs
 *               them against the same cache. Anything Realtime missed surfaces
 *               here, and the count of such recoveries is itself the signal
 *               that Realtime has gone quiet while claiming to be connected.
 *
 * Both paths funnel through one cache, so a row seen twice produces one event.
 */
export class CallWatcher {
  private readonly cache = new CallStateCache();
  private channel: RealtimeChannel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  private stopped = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly handlers: WatcherHandlers,
  ) {}

  async start(): Promise<void> {
    // 1. Seed from current state WITHOUT emitting. Without this, a restart at
    //    16:00 would replay every call made since 09:00 and re-announce the
    //    lot. Qtech's model tolerates a lost event (the next call supersedes
    //    it); it does not tolerate forty spurious ones.
    const seeded = await this.seed();

    // 2. Optionally restore the wall to correct current state — one silent
    //    call per counter, newest first. `silent` is a documented optional
    //    field (§1), so this uses the interface as specified rather than
    //    inventing a display instruction Qtech does not offer.
    if (this.config.resyncOnStart) this.emitResync(seeded);

    this.subscribe();
    this.startReconcileLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.channel) {
      try {
        await this.channel.unsubscribe();
      } catch {
        // tearing down
      }
      this.channel = null;
    }
  }

  // ── Seeding ──────────────────────────────────────────────────────────────

  private async seed(): Promise<readonly KioskCallRow[]> {
    const rows = await this.fetchTodayForSeed();
    for (const row of rows) this.cache.remember(row);
    this.logger.info('seeded call cache from current state', {
      rows: rows.length,
      queueDate: sgtToday(),
    });
    return rows;
  }

  private emitResync(rows: readonly KioskCallRow[]): void {
    // Newest call per counter is what the wall should currently be showing.
    const newestPerCounter = new Map<number, KioskCallRow>();
    for (const row of rows) {
      if (row.counter_number === null) continue;
      const current = newestPerCounter.get(row.counter_number);
      if (!current || compareCalledAt(row, current) > 0) {
        newestPerCounter.set(row.counter_number, row);
      }
    }
    if (newestPerCounter.size === 0) return;

    this.logger.info('resyncing wall state after start', {
      counters: newestPerCounter.size,
      silent: true,
    });
    for (const row of newestPerCounter.values()) {
      const candidate = this.buildCandidate(row, { resync: true });
      this.handlers.onCandidate(candidate, 'resync');
    }
  }

  // ── Realtime ─────────────────────────────────────────────────────────────

  private subscribe(): void {
    this.channel = this.supabase
      .channel('qtech-bridge-kiosk-checkins')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'kiosk_checkins' },
        (payload: { new: Record<string, unknown> }) => {
          this.handlers.onRealtimeEvent();
          this.ingest(payload.new, 'realtime');
        },
      )
      .subscribe((status: string) => {
        const connected = status === 'SUBSCRIBED';
        this.handlers.onRealtimeState(connected);
        if (connected) this.logger.info('realtime subscribed', { table: 'kiosk_checkins' });
        else this.logger.warn('realtime channel state', { status });
      });
  }

  // ── Reconcile ────────────────────────────────────────────────────────────

  private startReconcileLoop(): void {
    this.timer = setInterval(() => {
      void this.reconcile();
    }, this.config.reconcileIntervalMs);
  }

  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    try {
      const rows = await this.fetchCalledToday();
      for (const row of rows) this.ingestRow(row, 'poll');
      const pruned = this.cache.pruneToDate(sgtToday());
      if (pruned > 0) {
        this.logger.debug('pruned cache across day rollover', { pruned, cached: this.cache.size });
      }
      this.handlers.onReconcile();
    } catch (err) {
      this.logger.warn('reconcile poll failed', { error: safeError(err) });
    }
  }

  /** Hot path: only rows currently at CALLED can produce a new event. */
  private fetchCalledToday(): Promise<readonly KioskCallRow[]> {
    return this.fetchToday(['CALLED']);
  }

  /**
   * Boot path: a wider net, because the wall shows the last number called at
   * each counter regardless of what that ticket has done since. If counter 7's
   * most recent call has already moved to PROCESSING, a CALLED-only read would
   * miss it and the resync would re-assert an *older* call still sitting at
   * CALLED for that counter — putting a stale number back on the wall, which
   * is worse than leaving it alone.
   *
   * Seeding the extra rows is harmless: a non-CALLED row never produces an
   * event, and if one returns to CALLED it does so with a fresh signature.
   */
  private fetchTodayForSeed(): Promise<readonly KioskCallRow[]> {
    return this.fetchToday(['CALLED', 'PROCESSING', 'RECEIVED']);
  }

  private async fetchToday(statuses: readonly string[]): Promise<readonly KioskCallRow[]> {
    const { data, error } = await this.supabase
      .from('kiosk_checkins')
      .select(KIOSK_CALL_COLUMNS)
      .eq('queue_date', sgtToday())
      .in('status', statuses)
      .order('called_at', { ascending: true })
      .limit(500);

    if (error) throw new Error(`kiosk_checkins read failed: ${error.message}`);
    return (data ?? []).flatMap((raw) => {
      const parsed = KioskCallRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
  }

  // ── Ingestion ────────────────────────────────────────────────────────────

  /**
   * Realtime hands us the entire row, including `client_name` and
   * `client_email`. Parsing through KioskCallRowSchema strips them at the
   * boundary — the raw object is never stored, logged, or forwarded.
   */
  private ingest(raw: unknown, source: CandidateSource): void {
    const parsed = KioskCallRowSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.debug('ignoring unparseable row', { source });
      return;
    }
    this.ingestRow(parsed.data, source);
  }

  private ingestRow(row: KioskCallRow, source: CandidateSource): void {
    if (!this.cache.isNew(row)) return;

    // Mark before dispatching. A delivery that fails after its final retry is
    // not re-attempted later: Qtech §4 is explicit that stopping is safe
    // because the next call event supersedes the lost one. The failure is
    // still recorded in qtech_call_log and surfaces in the health row.
    this.cache.remember(row);

    const candidate = this.buildCandidate(row, { resync: false });
    this.handlers.onCandidate(candidate, source);
  }

  // ── Candidate construction ───────────────────────────────────────────────

  private buildCandidate(row: KioskCallRow, opts: { resync: boolean }): CallCandidate {
    const signature = callSignature(row);
    const queueNo = resolveQueueNo(row.display_number, row.queue_number, row.queue_series);

    if (!queueNo) {
      return {
        kind: 'blocked',
        blocked: {
          ticketId: row.id,
          queueNo: '-',
          reason: 'QUEUE_NO_MISSING',
          detail: `queue_number and display_number are both empty (series=${row.queue_series ?? 'null'})`,
          signature,
        },
      };
    }

    if (row.counter_number === null) {
      // Nexus permits a call with no counter assigned (counterNumber is
      // optional on every call endpoint). Qtech requires counterName, so this
      // cannot be delivered. Blocked locally with a reason rather than sent
      // and bounced as VALIDATION_ERROR.
      return {
        kind: 'blocked',
        blocked: {
          ticketId: row.id,
          queueNo,
          reason: 'COUNTER_MISSING',
          detail: 'called with no counter assigned',
          signature,
        },
      };
    }

    if (!isCounterAllowed(row.counter_number, this.config)) {
      return {
        kind: 'blocked',
        blocked: {
          ticketId: row.id,
          queueNo,
          reason: 'COUNTER_NOT_ALLOWED',
          detail: `counter ${row.counter_number} is not in the agreed Qtech counter list`,
          signature,
        },
      };
    }

    const counterName = formatCounterName(row.counter_number, this.config);
    const eventId = opts.resync
      ? deriveResyncEventId(this.bootId, row.id, signature)
      : deriveEventId(row.id, signature);

    return {
      kind: 'send',
      event: {
        eventId,
        ticketId: row.id,
        queueNo,
        counterName,
        silent: opts.resync,
        timestamp: normaliseTimestamp(row.called_at ?? row.last_called_at),
        signature,
      },
    };
  }
}

/**
 * `timestamp` is required on every call (§6) though Qtech uses it only for
 * audit. Supabase renders timestamptz in more than one shape depending on the
 * column and driver, so normalise to a canonical ISO instant rather than
 * forwarding whatever came back — and fall back to now() rather than sending
 * something unparseable and drawing a VALIDATION_ERROR.
 */
function normaliseTimestamp(raw: string | null): string {
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function compareCalledAt(a: KioskCallRow, b: KioskCallRow): number {
  const ta = Date.parse(a.last_called_at ?? a.called_at ?? '') || 0;
  const tb = Date.parse(b.last_called_at ?? b.called_at ?? '') || 0;
  return ta - tb;
}
