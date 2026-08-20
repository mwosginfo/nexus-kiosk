import type { SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { safeError } from '../logger.js';
import { sgtToday } from './client.js';

export type CallOutcome = 'SENT' | 'DUPLICATE' | 'FAILED' | 'BLOCKED' | 'DRY_RUN';

export interface CallLogEntry {
  readonly eventId: string;
  readonly ticketId: string;
  readonly queueNo: string;
  readonly counterName: string | null;
  readonly outcome: CallOutcome;
  readonly attempts: number;
  readonly httpStatus: number | null;
  readonly qtechCode: string | null;
  readonly errorMessage: string | null;
  readonly latencyMs: number | null;
  readonly silent: boolean;
}

/**
 * What the dispatcher needs from the health layer. Narrowing the dependency to
 * this keeps delivery logic testable without a Supabase connection, and makes
 * the write surface explicit.
 */
export interface HealthSink {
  noteOutcome(entry: CallLogEntry): void;
  writeLog(entry: CallLogEntry): Promise<void>;
}

interface HealthState {
  realtimeConnected: boolean;
  realtimeLastEventAt: string | null;
  reconcileLastRunAt: string | null;
  qtechHealthOk: boolean | null;
  qtechHealthCheckedAt: string | null;
  lastCallSentAt: string | null;
  lastCallErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  statsDate: string;
  sentToday: number;
  failedToday: number;
  blockedToday: number;
  duplicateToday: number;
  recoveredByPollToday: number;
}

/**
 * The "Nexus will know" half of the bridge.
 *
 * The bridge never talks to Nexus. Instead it keeps this row current in
 * Supabase, and Nexus reads `qtech_bridge_status` — a view that collapses
 * everything below into a single OK / DEGRADED / DOWN string.
 *
 * The heartbeat is the important part. Every other failure mode logs
 * *something* somewhere; a dead Pi logs nothing at all, and the only way to
 * notice is that a row which should be changing has stopped changing. So the
 * write happens unconditionally on a timer, not only when something happens.
 */
export class HealthWriter implements HealthSink {
  private readonly startedAt = new Date().toISOString();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private dirty = false;

  private readonly state: HealthState = {
    realtimeConnected: false,
    realtimeLastEventAt: null,
    reconcileLastRunAt: null,
    qtechHealthOk: null,
    qtechHealthCheckedAt: null,
    lastCallSentAt: null,
    lastCallErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    consecutiveFailures: 0,
    statsDate: sgtToday(),
    sentToday: 0,
    failedToday: 0,
    blockedToday: 0,
    duplicateToday: 0,
    recoveredByPollToday: 0,
  };

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly version: string,
  ) {}

  start(): void {
    void this.flush();
    this.timer = setInterval(() => void this.flush(), this.config.heartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final beat so the row reflects a clean shutdown rather than going stale
    // and being reported as DOWN by a crash-shaped signal.
    this.state.realtimeConnected = false;
    await this.flush();
  }

  // ── State mutation ───────────────────────────────────────────────────────

  setRealtimeConnected(connected: boolean): void {
    if (this.state.realtimeConnected !== connected) {
      this.state.realtimeConnected = connected;
      void this.flush();
    }
  }

  noteRealtimeEvent(): void {
    this.state.realtimeLastEventAt = new Date().toISOString();
  }

  noteReconcile(): void {
    this.state.reconcileLastRunAt = new Date().toISOString();
  }

  noteQtechHealth(ok: boolean): void {
    const changed = this.state.qtechHealthOk !== ok;
    this.state.qtechHealthOk = ok;
    this.state.qtechHealthCheckedAt = new Date().toISOString();
    if (changed) void this.flush();
  }

  noteRecoveredByPoll(): void {
    this.rollDay();
    this.state.recoveredByPollToday += 1;
  }

  noteOutcome(entry: CallLogEntry): void {
    this.rollDay();
    const now = new Date().toISOString();

    switch (entry.outcome) {
      case 'SENT':
      case 'DRY_RUN':
        this.state.sentToday += 1;
        this.state.lastCallSentAt = now;
        this.state.consecutiveFailures = 0;
        break;
      case 'DUPLICATE':
        this.state.duplicateToday += 1;
        this.state.lastCallSentAt = now;
        this.state.consecutiveFailures = 0;
        break;
      case 'FAILED':
        this.state.failedToday += 1;
        this.state.lastCallErrorAt = now;
        this.state.lastErrorCode = entry.qtechCode ?? 'DELIVERY_FAILED';
        this.state.lastErrorMessage = entry.errorMessage;
        this.state.consecutiveFailures += 1;
        break;
      case 'BLOCKED':
        // Counts toward the failure streak as well. A blocked call never
        // reaches Qtech, so nothing on the Qtech side is wrong — but a number
        // was called and did not appear on the wall, which is the same outcome
        // for the client standing in front of it. Without this, a systemic
        // problem (nobody assigning counters) would leave every call blocked
        // while the health view still reported OK. `last_error_code` keeps the
        // two causes distinguishable (COUNTER_MISSING vs RETRIES_EXHAUSTED).
        this.state.blockedToday += 1;
        this.state.lastCallErrorAt = now;
        this.state.lastErrorCode = entry.qtechCode ?? 'BLOCKED';
        this.state.lastErrorMessage = entry.errorMessage;
        this.state.consecutiveFailures += 1;
        break;
    }

    // A failure is the moment staff most need the badge to be current — don't
    // wait up to a full heartbeat interval to say so.
    if (entry.outcome === 'FAILED' || entry.outcome === 'BLOCKED') void this.flush();
  }

  private rollDay(): void {
    const today = sgtToday();
    if (this.state.statsDate === today) return;
    this.state.statsDate = today;
    this.state.sentToday = 0;
    this.state.failedToday = 0;
    this.state.blockedToday = 0;
    this.state.duplicateToday = 0;
    this.state.recoveredByPollToday = 0;
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Coalescing flush.
   *
   * An earlier version simply dropped a flush that arrived while another was
   * in flight. That loses the newest state: a burst of failures — the exact
   * moment the health row matters most — would leave it understating the
   * failure count until the next heartbeat, up to 15s later. Instead, a flush
   * arriving mid-write marks the state dirty and the writer loops, so the last
   * write always reflects the final state. Callers awaiting `flush()` await
   * that settled result.
   */
  flush(): Promise<void> {
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    this.inFlight = this.runFlush().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runFlush(): Promise<void> {
    do {
      this.dirty = false;
      await this.write();
    } while (this.dirty);
  }

  private async write(): Promise<void> {
    try {
      const { error } = await this.supabase.from('qtech_bridge_health').upsert(
        {
          bridge_id: this.config.bridgeId,
          updated_at: new Date().toISOString(),
          started_at: this.startedAt,
          version: this.version,
          realtime_connected: this.state.realtimeConnected,
          realtime_last_event_at: this.state.realtimeLastEventAt,
          reconcile_last_run_at: this.state.reconcileLastRunAt,
          qtech_health_ok: this.state.qtechHealthOk,
          qtech_health_checked_at: this.state.qtechHealthCheckedAt,
          last_call_sent_at: this.state.lastCallSentAt,
          last_call_error_at: this.state.lastCallErrorAt,
          last_error_code: this.state.lastErrorCode,
          last_error_message: this.state.lastErrorMessage,
          consecutive_failures: this.state.consecutiveFailures,
          stats_date: this.state.statsDate,
          sent_today: this.state.sentToday,
          failed_today: this.state.failedToday,
          blocked_today: this.state.blockedToday,
          duplicate_today: this.state.duplicateToday,
          recovered_by_poll_today: this.state.recoveredByPollToday,
          dry_run: this.config.dryRun,
        },
        { onConflict: 'bridge_id' },
      );
      if (error) {
        this.logger.warn('health upsert failed', { error: error.message });
      }
    } catch (err) {
      this.logger.warn('health upsert threw', { error: safeError(err) });
    }
  }

  /**
   * Append-only outcome log. Keyed on event_id so a re-delivery of the same
   * derived event replaces its row rather than duplicating it.
   */
  async writeLog(entry: CallLogEntry): Promise<void> {
    try {
      const { error } = await this.supabase.from('qtech_call_log').upsert(
        {
          bridge_id: this.config.bridgeId,
          event_id: entry.eventId,
          ticket_id: entry.ticketId,
          queue_no: entry.queueNo,
          counter_name: entry.counterName,
          outcome: entry.outcome,
          attempts: entry.attempts,
          http_status: entry.httpStatus,
          qtech_code: entry.qtechCode,
          error_message: entry.errorMessage,
          latency_ms: entry.latencyMs,
          silent: entry.silent,
        },
        { onConflict: 'event_id' },
      );
      if (error) this.logger.warn('call log write failed', { error: error.message });
    } catch (err) {
      this.logger.warn('call log write threw', { error: safeError(err) });
    }
  }
}
