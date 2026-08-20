import { z } from 'zod';

/**
 * The projection of `kiosk_checkins` this bridge is allowed to hold.
 *
 * DATA MINIMISATION — deliberate and load-bearing:
 * `kiosk_checkins` also carries `client_name`, `client_email`, `ref_code` and
 * `transaction_ref`. None of them appear here. Supabase Realtime hands us the
 * *whole* row on every UPDATE, so the projection below is applied at the
 * boundary (`projectRow`) and the raw payload is discarded immediately. It is
 * never logged, never cached, and never reaches the Qtech client.
 *
 * Qtech's integration response §6 is explicit: no personal data is required,
 * and any that is transmitted will be rejected rather than stored.
 */
export const KioskCallRowSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  queue_number: z.number().int().nullable(),
  display_number: z.string().nullable(),
  queue_series: z.string().nullable(),
  counter_number: z.number().int().nullable(),
  called_at: z.string().nullable(),
  last_called_at: z.string().nullable(),
  call_count: z.number().int().nullable(),
  queue_date: z.string().nullable(),
});

export type KioskCallRow = z.infer<typeof KioskCallRowSchema>;

/** The exact column list to SELECT. Keeps PII off the wire on the poll path. */
export const KIOSK_CALL_COLUMNS =
  'id,status,queue_number,display_number,queue_series,counter_number,called_at,last_called_at,call_count,queue_date';

/**
 * A single announcement to be delivered to Qtech.
 *
 * `eventId` is derived deterministically (see domain/event-id.ts) so that a
 * retry of the same call — including a retry after a process restart — reuses
 * the key and Qtech suppresses the re-announcement, while a deliberate recall
 * produces a different key and does re-announce. Qtech integration response
 * §4 (Duplicate handling) and item 7.5.
 */
export interface CallEvent {
  readonly eventId: string;
  /** kiosk_checkins.id — opaque UUID, unique per ticket, never reused, no PII. */
  readonly ticketId: string;
  readonly queueNo: string;
  readonly counterName: string;
  /** Suppresses chime/voice. Used only for the boot resync. */
  readonly silent: boolean;
  /** Advisory, audit-only on Qtech's side. */
  readonly timestamp: string;
  /** Internal: the signature this event was derived from (for the cache). */
  readonly signature: string;
}

/** A call that cannot be delivered and must not be sent. Recorded, not retried. */
export interface BlockedCall {
  readonly ticketId: string;
  readonly queueNo: string;
  readonly reason: 'COUNTER_MISSING' | 'COUNTER_NOT_ALLOWED' | 'QUEUE_NO_MISSING';
  readonly detail: string;
  readonly signature: string;
}

export type CallCandidate =
  | { readonly kind: 'send'; readonly event: CallEvent }
  | { readonly kind: 'blocked'; readonly blocked: BlockedCall };

export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
