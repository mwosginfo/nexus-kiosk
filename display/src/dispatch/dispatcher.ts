import type { Logger } from '../logger.js';
import { assertNever, type CallCandidate, type CallEvent } from '../types.js';
import type { CallTransport } from '../qtech/transport.js';
import type { HealthSink } from '../supabase/health-writer.js';
import { deriveEventId } from '../domain/event-id.js';
import { PerCounterQueue } from './serial-queue.js';
import { MAX_ATTEMPTS, delayBeforeAttempt, sleep } from './retry.js';

/**
 * Delivery. Takes candidates from the watcher and gets them to Qtech, or
 * records precisely why they did not get there.
 */
export class Dispatcher {
  private readonly queue = new PerCounterQueue();

  constructor(
    private readonly qtech: CallTransport,
    private readonly health: HealthSink,
    private readonly logger: Logger,
    private readonly abort: AbortSignal,
  ) {}

  submit(candidate: CallCandidate): void {
    switch (candidate.kind) {
      case 'blocked': {
        const { blocked } = candidate;
        this.logger.warn('call blocked before send', {
          ticketID: blocked.ticketId,
          queueNo: blocked.queueNo,
          reason: blocked.reason,
        });
        this.health.noteOutcome({
          eventId: blockedEventId(blocked.ticketId, blocked.signature),
          ticketId: blocked.ticketId,
          queueNo: blocked.queueNo,
          counterName: null,
          outcome: 'BLOCKED',
          attempts: 0,
          httpStatus: null,
          qtechCode: blocked.reason,
          errorMessage: blocked.detail,
          latencyMs: null,
          silent: false,
        });
        void this.health.writeLog({
          eventId: blockedEventId(blocked.ticketId, blocked.signature),
          ticketId: blocked.ticketId,
          queueNo: blocked.queueNo,
          counterName: null,
          outcome: 'BLOCKED',
          attempts: 0,
          httpStatus: null,
          qtechCode: blocked.reason,
          errorMessage: blocked.detail,
          latencyMs: null,
          silent: false,
        });
        return;
      }
      case 'send': {
        const { event } = candidate;
        // Serialised per counter so a stale call cannot overwrite a newer one
        // at the same counter (Qtech §4, Ordering).
        void this.queue.enqueue(event.counterName, () => this.deliver(event));
        return;
      }
      default:
        return assertNever(candidate);
    }
  }

  /** One event, up to MAX_ATTEMPTS, honouring the retry rules in §4. */
  private async deliver(event: CallEvent): Promise<void> {
    let attempt = 0;
    let lastDetail = '';
    let lastStatus: number | null = null;

    while (attempt < MAX_ATTEMPTS && !this.abort.aborted) {
      attempt += 1;
      const wait = delayBeforeAttempt(attempt);
      if (wait > 0) await sleep(wait, this.abort);
      if (this.abort.aborted) break;

      const result = await this.qtech.call(event);

      switch (result.kind) {
        case 'success': {
          const outcome = result.duplicate ? 'DUPLICATE' : 'SENT';
          this.logger.info('call delivered', {
            eventId: event.eventId,
            ticketID: event.ticketId,
            queueNo: event.queueNo,
            counterName: event.counterName,
            duplicate: result.duplicate,
            attempts: attempt,
            latencyMs: result.latencyMs,
            silent: event.silent,
          });
          this.record(event, {
            outcome,
            attempts: attempt,
            httpStatus: result.httpStatus,
            qtechCode: null,
            errorMessage: null,
            latencyMs: result.latencyMs,
          });
          return;
        }

        case 'business-error': {
          // Never retried — the outcome will not change on repeat (§4).
          this.logger.error('call rejected by Qtech', {
            eventId: event.eventId,
            ticketID: event.ticketId,
            queueNo: event.queueNo,
            counterName: event.counterName,
            code: result.code,
            httpStatus: result.httpStatus,
            attempts: attempt,
          });
          this.record(event, {
            outcome: 'FAILED',
            attempts: attempt,
            httpStatus: result.httpStatus,
            qtechCode: result.code,
            errorMessage: result.detail,
            latencyMs: result.latencyMs,
          });
          return;
        }

        case 'transient': {
          lastDetail = result.detail;
          lastStatus = result.httpStatus;
          this.logger.warn('call attempt failed, will retry if attempts remain', {
            eventId: event.eventId,
            queueNo: event.queueNo,
            counterName: event.counterName,
            httpStatus: result.httpStatus,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
          });
          break;
        }

        default:
          return assertNever(result);
      }
    }

    // Exhausted. Stopping here is safe by design: Qtech §4 states the next
    // call event supersedes the lost one, and there is no reconciliation feed
    // to catch up against. What must NOT happen is this passing unnoticed —
    // hence the health row, which is what makes the wall's staleness visible
    // on the Nexus side.
    this.logger.error('call abandoned after final retry — display may be stale', {
      eventId: event.eventId,
      ticketID: event.ticketId,
      queueNo: event.queueNo,
      counterName: event.counterName,
      attempts: attempt,
      lastStatus,
    });
    this.record(event, {
      outcome: 'FAILED',
      attempts: attempt,
      httpStatus: lastStatus,
      qtechCode: 'RETRIES_EXHAUSTED',
      errorMessage: lastDetail || 'no response after final retry',
      latencyMs: null,
    });
  }

  private record(
    event: CallEvent,
    result: {
      outcome: 'SENT' | 'DUPLICATE' | 'FAILED';
      attempts: number;
      httpStatus: number | null;
      qtechCode: string | null;
      errorMessage: string | null;
      latencyMs: number | null;
    },
  ): void {
    const entry = {
      eventId: event.eventId,
      ticketId: event.ticketId,
      queueNo: event.queueNo,
      counterName: event.counterName,
      outcome: result.outcome,
      attempts: result.attempts,
      httpStatus: result.httpStatus,
      qtechCode: result.qtechCode,
      errorMessage: result.errorMessage,
      latencyMs: result.latencyMs,
      silent: event.silent,
    } as const;
    this.health.noteOutcome(entry);
    void this.health.writeLog(entry);
  }

  get pending(): number {
    return this.queue.pending;
  }

  drain(): Promise<void> {
    return this.queue.drain();
  }
}

/**
 * Blocked calls never reach Qtech, but still need a stable log key. Reusing the
 * live derivation means the log row lines up with the event that would have
 * been sent had the counter been valid.
 */
function blockedEventId(ticketId: string, signature: string): string {
  return deriveEventId(ticketId, signature);
}
