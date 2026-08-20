import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { safeError } from '../logger.js';
import type { CallEvent } from '../types.js';
import {
  CallRequestSchema,
  CallResponseSchema,
  extractDuplicate,
  extractErrorCode,
  isSuccess,
  type CallRequest,
} from './schemas.js';

/**
 * Outcome of one HTTP attempt. `retryable` encodes the Qtech §4 rule:
 * retry only on network failure, timeout, HTTP 5xx or HTTP 429; never on a
 * business error, because the outcome will not change on repeat.
 */
export type AttemptResult =
  | { readonly kind: 'success'; readonly httpStatus: number; readonly duplicate: boolean; readonly latencyMs: number }
  | { readonly kind: 'business-error'; readonly httpStatus: number; readonly code: string | null; readonly detail: string; readonly latencyMs: number }
  | { readonly kind: 'transient'; readonly httpStatus: number | null; readonly detail: string; readonly latencyMs: number };

export class QtechClient {
  private readonly authHeader: string;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    const raw = `${config.qtechUsername}:${config.qtechPassword}`;
    this.authHeader = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }

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

  /** One attempt. Retry policy lives in dispatch/retry.ts. */
  async call(event: CallEvent): Promise<AttemptResult> {
    const body = this.buildRequest(event);
    const started = Date.now();

    if (this.config.dryRun) {
      this.logger.info('dry-run: call suppressed', {
        eventId: body.eventId,
        ticketID: body.ticketID,
        queueNo: body.queueNo,
        counterName: body.counterName,
      });
      return { kind: 'success', httpStatus: 0, duplicate: false, latencyMs: 0 };
    }

    return this.post('/call', body, started);
  }

  /**
   * One attempt, returning the untouched HTTP status and body.
   *
   * Used only by the conformance CLI. Their Phase 1 exit criterion is that
   * "every response matches the published schema and error codes", which
   * requires seeing the raw response rather than this client's classification
   * of it. No retry: a conformance check wants exactly one request.
   */
  async rawCall(event: CallEvent): Promise<{
    readonly httpStatus: number;
    readonly body: string;
    readonly latencyMs: number;
    readonly request: CallRequest;
  }> {
    const body = this.buildRequest(event);
    const started = Date.now();
    const res = await this.fetchWithTimeout(`${this.baseUrl()}/call`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    return {
      httpStatus: res.status,
      body: text,
      latencyMs: Date.now() - started,
      request: body,
    };
  }

  /** Liveness + branch resolution check (§1). Used as the periodic probe. */
  async health(): Promise<boolean> {
    if (this.config.dryRun) return true;
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl()}/health`, {
        method: 'GET',
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
      });
      // Drain so the socket can be reused.
      await res.text().catch(() => '');
      return res.ok;
    } catch (err) {
      this.logger.warn('qtech health probe failed', { error: safeError(err) });
      return false;
    }
  }

  private async post(path: string, body: CallRequest, started: number): Promise<AttemptResult> {
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network failure or client timeout — retryable per §4.
      return {
        kind: 'transient',
        httpStatus: null,
        detail: safeError(err),
        latencyMs: Date.now() - started,
      };
    }

    const latencyMs = Date.now() - started;
    const text = await res.text().catch(() => '');

    if (res.status >= 500 || res.status === 429) {
      return { kind: 'transient', httpStatus: res.status, detail: truncate(text), latencyMs };
    }

    if (!res.ok) {
      // 4xx other than 429 — including 401/403. Not retryable: a bad credential
      // or a malformed payload will not fix itself on repeat.
      return {
        kind: 'business-error',
        httpStatus: res.status,
        code: res.status === 401 || res.status === 403 ? 'AUTH_FAILED' : null,
        detail: truncate(text),
        latencyMs,
      };
    }

    const parsed = CallResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      // A 2xx we cannot interpret. Treat as a business error rather than
      // retrying: the request was accepted, so replaying it risks a double
      // announcement once the duplicate window closes.
      return {
        kind: 'business-error',
        httpStatus: res.status,
        code: 'UNPARSEABLE_RESPONSE',
        detail: truncate(text),
        latencyMs,
      };
    }

    if (isSuccess(parsed.data)) {
      return {
        kind: 'success',
        httpStatus: res.status,
        duplicate: extractDuplicate(parsed.data),
        latencyMs,
      };
    }

    return {
      kind: 'business-error',
      httpStatus: res.status,
      code: extractErrorCode(parsed.data),
      detail: truncate(text),
      latencyMs,
    };
  }

  private baseUrl(): string {
    return this.config.qtechBaseUrl.replace(/\/+$/, '');
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.qtechTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function truncate(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}
