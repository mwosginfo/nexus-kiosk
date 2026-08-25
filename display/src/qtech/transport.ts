import type { CallEvent } from '../types.js';

/**
 * What the dispatcher needs from a transport, independent of how the call
 * actually reaches Qtech.
 *
 * Qtech advised on 2026-08-20 that they intend to move from HTTPS REST to a
 * raw TCP protocol. The workflow is unchanged — one call event per number
 * called to a counter — but the wire format, framing, authentication and
 * error signalling are all defined in HTTP terms in their 5 August
 * integration response and will need reissuing.
 *
 * This interface is the seam. Everything above it — call detection, event id
 * derivation, per-counter ordering, retry policy, health reporting — is
 * transport-agnostic and does not change. Swapping transports means providing
 * another implementation of this interface.
 *
 * NOTE on `AttemptResult`: the three outcomes below are the minimum the retry
 * policy needs to function, and they presume the transport can tell them
 * apart. That holds for HTTP because the response carries the outcome. It
 * holds for a TCP protocol ONLY IF the protocol acknowledges each call. If
 * Qtech's TCP interface turns out to be fire-and-forget, the distinction
 * between `success`, `business-error` and `transient` cannot be made at all,
 * and the retry policy, duplicate handling and delivery reporting all have to
 * be reconsidered — see docs/QTECH-TCP-QUESTIONS.md.
 */
export type AttemptResult =
  | {
      readonly kind: 'success';
      readonly httpStatus: number;
      readonly duplicate: boolean;
      readonly latencyMs: number;
    }
  | {
      readonly kind: 'business-error';
      readonly httpStatus: number;
      readonly code: string | null;
      readonly detail: string;
      readonly latencyMs: number;
    }
  | {
      readonly kind: 'transient';
      readonly httpStatus: number | null;
      readonly detail: string;
      readonly latencyMs: number;
    };

export interface CallTransport {
  /** Deliver one call. No retry — the dispatcher owns retry policy. */
  call(event: CallEvent): Promise<AttemptResult>;
  /** Liveness probe. Returns false when Qtech cannot be reached. */
  health(): Promise<boolean>;
}
