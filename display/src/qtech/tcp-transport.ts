import { connect, type Socket } from 'node:net';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { safeError } from '../logger.js';
import type { CallEvent } from '../types.js';
import type { AttemptResult, CallTransport } from './transport.js';
import { FrameReader, encodeFrame } from './framing.js';
import {
  CallRequestSchema,
  CallResponseSchema,
  extractDuplicate,
  extractErrorCode,
  isSuccess,
  type CallRequest,
} from './schemas.js';

/**
 * TCP implementation of `CallTransport`.
 *
 * Qtech confirmed (2026-08-20) that the JSON is unchanged and only the carrier
 * differs: the same request object, over TCP instead of HTTPS, to equipment on
 * the same network as the bridge. So the payload builder and the response
 * schemas are shared with the HTTP transport rather than duplicated — if the
 * message shape ever diverges, that will be a deliberate edit in one place.
 *
 * ── One connection per call ────────────────────────────────────────────────
 *
 * This opens a connection, sends one call, reads the reply and closes.
 *
 * A long-lived connection would save the handshake, but on a local network
 * that is roughly a millisecond against a call volume of a few hundred a day.
 * What it would cost is the half-open failure mode: a TCP connection whose
 * peer has gone away without sending a FIN stays open indefinitely, accepts
 * writes into the kernel buffer, and reports no error — so the bridge would
 * announce into a dead socket while the wall silently stopped updating. That
 * is precisely the failure Qtech's item 9 asks us to make visible, and it is
 * far easier to avoid than to detect.
 *
 * Connecting per call makes every failure immediate and local: a refused
 * connection, a timeout or a reset surfaces on the call that caused it and
 * flows into the existing retry and health reporting. If Qtech require a
 * persistent connection, this is where that changes, and an acknowledged
 * application-level ping becomes necessary rather than optional.
 */
export class QtechTcpTransport implements CallTransport {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  buildRequest(event: CallEvent): CallRequest {
    return CallRequestSchema.parse({
      eventId: event.eventId,
      ticketID: event.ticketId,
      branchUUID: this.config.qtechBranchUuid,
      counterName: event.counterName,
      queueNo: event.queueNo,
      ...(event.silent ? { silent: true } : {}),
      timestamp: event.timestamp,
    });
  }

  async call(event: CallEvent): Promise<AttemptResult> {
    const request = this.buildRequest(event);
    const started = Date.now();

    if (this.config.dryRun) {
      this.logger.info('dry-run: call suppressed', {
        eventId: request.eventId,
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
      // Connection refused, reset, timeout — all retryable per Qtech §4.
      return {
        kind: 'transient',
        httpStatus: null,
        detail: safeError(err),
        latencyMs: Date.now() - started,
      };
    }

    const latencyMs = Date.now() - started;

    if (raw === null) {
      // Peer closed without replying. Treated as transient: the call may or
      // may not have been acted on, and the derived eventId makes a retry
      // safe — Qtech suppress a repeat within their duplicate window.
      return {
        kind: 'transient',
        httpStatus: null,
        detail: 'connection closed without a response',
        latencyMs,
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw) as unknown;
    } catch {
      return {
        kind: 'business-error',
        httpStatus: 0,
        code: 'UNPARSEABLE_RESPONSE',
        detail: raw.slice(0, 300),
        latencyMs,
      };
    }

    const parsed = CallResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      // Well-formed JSON that is not the agreed envelope. Not retried: the
      // call was received, so replaying it risks a second announcement once
      // the duplicate window closes.
      return {
        kind: 'business-error',
        httpStatus: 0,
        code: 'UNEXPECTED_RESPONSE_SHAPE',
        detail: raw.slice(0, 300),
        latencyMs,
      };
    }

    if (isSuccess(parsed.data)) {
      return {
        kind: 'success',
        httpStatus: 0,
        duplicate: extractDuplicate(parsed.data),
        latencyMs,
      };
    }

    return {
      kind: 'business-error',
      httpStatus: 0,
      code: extractErrorCode(parsed.data),
      detail: raw.slice(0, 300),
      latencyMs,
    };
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

  /** Send one framed message and read one framed reply. */
  private exchange(json: string): Promise<string | null> {
    const { qtechTcpHost: host, qtechTcpPort: port, qtechTcpFraming: framing } = this.config;

    return new Promise<string | null>((resolve, reject) => {
      const reader = new FrameReader(framing);
      let settled = false;
      let socket: Socket;

      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        reject(err);
      };

      socket = connect({ host, port }, () => {
        socket.write(encodeFrame(json, framing), (err) => {
          if (err) fail(err);
        });
      });

      // Covers connect, write and read together. Qtech recommended a 10s
      // client timeout for the HTTP interface; the same budget applies here.
      socket.setTimeout(this.config.qtechTimeoutMs);

      socket.on('data', (chunk: Buffer) => {
        try {
          reader.push(chunk);
          const message = reader.next();
          if (message !== null) finish(message);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });

      // For `raw` framing the close is the delimiter. For the others, a close
      // with nothing complete in hand means the peer hung up mid-message.
      socket.on('end', () => finish(reader.flush()));
      socket.on('close', () => finish(reader.flush()));

      socket.on('timeout', () => fail(new Error(`no response within ${this.config.qtechTimeoutMs}ms`)));
      socket.on('error', (err) => fail(err));
    });
  }
}
