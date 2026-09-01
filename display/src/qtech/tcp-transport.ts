import { connect, type Socket } from 'node:net';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { safeError } from '../logger.js';
import type { CallEvent } from '../types.js';
import type { AttemptResult, CallTransport } from './transport.js';
import { FrameReader, encodeFrame } from './framing.js';
import { formatTicketId, formatTimestamp } from './wire-format.js';
import {
  TcpAckSchema,
  TcpCallMessageSchema,
  ackErrorCode,
  ackIsError,
  type TcpCallMessage,
} from './tcp-schemas.js';

/**
 * TCP implementation of `CallTransport`, matching the `call.bat` reference
 * client Qtech supplied on 2026-08-20.
 *
 * Their client connects, writes one newline-terminated JSON message, flushes,
 * and closes — without reading anything. There is no acknowledgement, no error
 * code, and no idempotency key on the wire.
 *
 * ── What fire-and-forget costs ─────────────────────────────────────────────
 *
 * Three guarantees from the 5 August integration response do not survive:
 *
 *   §4 retry rule      A transient fault and a business error are
 *                      indistinguishable, because neither is reported. We can
 *                      only see failures at the connection level.
 *   §4 duplicates      There is no eventId, so Qtech cannot suppress a repeat.
 *                      Our own detection cache is now the ONLY thing standing
 *                      between a double-fire and a number announced twice.
 *   item 7.9           "Delivered" degrades to "written to a socket that
 *                      accepted the bytes". A call rejected on their side —
 *                      bad token, unknown counter — is invisible to us.
 *
 * These are stated plainly rather than papered over, because the health
 * reporting that tells counter staff the wall may be stale can only be as
 * honest as the transport underneath it.
 *
 * ── Optimistic acknowledgement ─────────────────────────────────────────────
 *
 * We write exactly what their client writes, then listen for a short grace
 * period (`qtechAckWaitMs`, default 250ms) before closing. Nothing in their
 * protocol says a reply will come; if one does, we parse and classify it and
 * the §4 retry rule works properly again. If none comes, the successful write
 * is reported as an unconfirmed send.
 *
 * The cost is a fraction of a second per call on a link that completes in
 * single-digit milliseconds; the benefit is that any error signalling Qtech
 * do provide, now or later, is picked up without a code change. Set
 * QTECH_ACK_WAIT_MS=0 to mirror their client exactly.
 *
 * ── One connection per call ────────────────────────────────────────────────
 *
 * As their client does. This also keeps the half-open failure mode off the
 * table: a persistent socket whose peer has gone without a FIN stays open,
 * accepts writes, and reports no error — so the bridge would announce into a
 * dead connection while the wall silently stopped. With fire-and-forget and no
 * acknowledgement, that failure would be entirely undetectable.
 */
export class QtechTcpTransport implements CallTransport {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  /**
   * Note what is NOT sent: `eventId`. Qtech's client does not carry one and we
   * do not add fields their parser has not been shown. It remains our internal
   * key for the call log and for retry identity.
   */
  buildRequest(event: CallEvent): TcpCallMessage {
    return TcpCallMessageSchema.parse({
      type: 'CALL',
      ticketID: formatTicketId(event.ticketId, this.config.qtechTicketIdStyle),
      clientId: this.config.qtechClientId,
      branchUUID: this.config.qtechBranchUuid,
      counterName: event.counterName,
      queueNo: event.queueNo,
      silent: event.silent,
      timestamp: event.timestamp,
      // Non-null by construction: config rejects a TCP setup without it.
      authToken: this.config.qtechAuthToken ?? '',
    });
  }

  async call(event: CallEvent): Promise<AttemptResult> {
    const request = this.buildRequest(event);
    const started = Date.now();

    if (this.config.dryRun) {
      this.logger.info('dry-run: call suppressed', {
        eventId: event.eventId,
        ticketID: request.ticketID,
        queueNo: request.queueNo,
        counterName: request.counterName,
      });
      return { kind: 'success', httpStatus: 0, duplicate: false, latencyMs: 0 };
    }

    let raw: string | null;
    try {
      raw = await this.exchange(JSON.stringify(request));
    } catch (err) {
      // Connection refused, reset, or a write that failed. Retryable per §4,
      // and the only failure class this protocol lets us observe.
      return {
        kind: 'transient',
        httpStatus: null,
        detail: safeError(err),
        latencyMs: Date.now() - started,
      };
    }

    const latencyMs = Date.now() - started;

    if (raw === null) {
      // The expected path: written and accepted, no reply. Reported as
      // success because that is the most the protocol allows us to know —
      // `httpStatus: 0` marks it unconfirmed rather than acknowledged.
      return { kind: 'success', httpStatus: 0, duplicate: false, latencyMs };
    }

    // A reply arrived, which their protocol does not promise. Use it.
    this.logger.info('qtech acknowledged a call', {
      ticketID: request.ticketID,
      queueNo: request.queueNo,
      bytes: raw.length,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw) as unknown;
    } catch {
      // Unreadable, but the write succeeded. Not retried: replaying a call
      // that may have been announced would announce it twice, and with no
      // eventId Qtech cannot suppress the repeat.
      return {
        kind: 'business-error',
        httpStatus: 0,
        code: 'UNPARSEABLE_ACK',
        detail: raw.slice(0, 300),
        latencyMs,
      };
    }

    const ack = TcpAckSchema.safeParse(parsedJson);
    if (!ack.success) {
      return {
        kind: 'business-error',
        httpStatus: 0,
        code: 'UNEXPECTED_ACK_SHAPE',
        detail: raw.slice(0, 300),
        latencyMs,
      };
    }

    if (ackIsError(ack.data)) {
      return {
        kind: 'business-error',
        httpStatus: 0,
        code: ackErrorCode(ack.data),
        detail: raw.slice(0, 300),
        latencyMs,
      };
    }

    return { kind: 'success', httpStatus: 1, duplicate: false, latencyMs };
  }

  /**
   * Liveness probe. There is no documented equivalent of `GET /health` on the
   * TCP interface, so this establishes a connection and closes it without
   * sending anything. That answers the question that matters for the health
   * row — is the Qtech endpoint accepting connections — without inventing a
   * message they have not specified.
   */
  async health(): Promise<boolean> {
    if (this.config.dryRun) return true;
    return new Promise<boolean>((resolve) => {
      const socket = connect({
        host: this.config.qtechTcpHost,
        port: this.config.qtechTcpPort,
      });
      const done = (ok: boolean): void => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(this.config.qtechTimeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', (err) => {
        this.logger.warn('qtech tcp probe failed', { error: safeError(err) });
        done(false);
      });
    });
  }

  /**
   * Write one framed message, then wait briefly for a reply that the protocol
   * does not promise.
   *
   * Resolves to the reply if one arrives inside the grace period, or to null
   * if the write succeeded and nothing came back — which is the normal path.
   * Rejects only when the connection or the write itself failed, which is the
   * one failure class this protocol exposes.
   */
  private exchange(json: string): Promise<string | null> {
    const {
      qtechTcpHost: host,
      qtechTcpPort: port,
      qtechTcpFraming: framing,
      qtechAckWaitMs: ackWaitMs,
    } = this.config;

    return new Promise<string | null>((resolve, reject) => {
      const reader = new FrameReader(framing);
      let settled = false;
      let written = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const socket: Socket = connect({ host, port });

      const cleanup = (): void => {
        if (graceTimer) clearTimeout(graceTimer);
        socket.removeAllListeners();
        socket.destroy();
      };
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      // Covers connect and write. Their own client allows 5s to connect.
      socket.setTimeout(this.config.qtechTimeoutMs);

      socket.once('connect', () => {
        socket.write(encodeFrame(json, framing), (err) => {
          if (err) {
            fail(err);
            return;
          }
          written = true;
          if (ackWaitMs <= 0) {
            // Mirror their client exactly: write, flush, close.
            finish(null);
            return;
          }
          // Listen for an unpromised reply, then give up quietly.
          graceTimer = setTimeout(() => finish(null), ackWaitMs);
        });
      });

      socket.on('data', (chunk: Buffer) => {
        try {
          reader.push(chunk);
          const message = reader.next();
          if (message !== null) finish(message);
        } catch (err) {
          // A malformed reply does not undo a successful write.
          finish(null);
          void err;
        }
      });

      // The peer closing after we have written is the expected end of a
      // fire-and-forget exchange, not a failure. Before the write lands, it is.
      const onClose = (): void => {
        if (!written) {
          fail(new Error('connection closed before the call was written'));
          return;
        }
        finish(reader.flush());
      };
      socket.on('end', onClose);
      socket.on('close', onClose);

      socket.on('timeout', () => {
        if (written) finish(null);
        else fail(new Error(`could not reach ${host}:${port} within ${this.config.qtechTimeoutMs}ms`));
      });
      socket.on('error', (err) => {
        if (written) finish(null);
        else fail(err);
      });
    });
  }

}
