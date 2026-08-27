import { z } from 'zod';

/**
 * The wire format Qtech's own client uses, transcribed from the `call.bat`
 * reference they supplied on 2026-08-20.
 *
 * This supersedes the shape in the 5 August integration response for the TCP
 * carrier. The differences are not cosmetic:
 *
 *   type        new — a message-type discriminator, constant 'CALL'
 *   clientId    new — identifies the calling system
 *   authToken   new — a shared secret in the payload. Their response said the
 *                     on-premises protocol carries no authentication; it does.
 *   eventId     GONE — there is no idempotency key on the wire at all
 *   silent      always present as a boolean, not omitted when false
 *   branchUUID  a plain string ('mwo'), not a UUID
 *
 * The absence of `eventId` is the consequential one. Their client writes the
 * message and closes without reading anything, so there is no acknowledgement,
 * no error code, and no duplicate suppression. See tcp-transport.ts for what
 * that costs and what we do about it.
 */
export const TcpCallMessageSchema = z.object({
  /** Constant. Qtech's client sends 'CALL' for every message. */
  type: z.literal('CALL'),
  /** Opaque, unique per ticket, never reused. Their sample uses 'T'+epoch_ms;
   *  we send the check-in row's UUID, which is stronger on all three counts. */
  ticketID: z.string().min(1).max(64),
  /** Identifies the calling system to Qtech. */
  clientId: z.string().min(1),
  /** Their sample sends the literal string 'mwo' — not a UUID despite the name. */
  branchUUID: z.string().min(1),
  counterName: z.string().min(1),
  queueNo: z.string().min(1),
  /** Always present, unlike the HTTP interface where it was optional. */
  silent: z.boolean(),
  timestamp: z.string().min(1),
  /** Shared secret. Held in the environment file, never in source control. */
  authToken: z.string().min(1),
});

export type TcpCallMessage = z.infer<typeof TcpCallMessageSchema>;

/**
 * Qtech's client never reads a reply, and we have no specification for one.
 * We still listen briefly (see `qtechAckWaitMs`) because a reply costs nothing
 * to accept and tells us something we otherwise cannot know. This is the
 * shape we would understand if one arrives — the envelope from the HTTPS
 * interface — parsed leniently so an unexpected variation is recorded rather
 * than discarded.
 */
export const TcpAckSchema = z.object({
  response: z.string().optional(),
  status: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  message: z.unknown().optional(),
});

export type TcpAck = z.infer<typeof TcpAckSchema>;

/** True when an acknowledgement, if any, indicates failure. */
export function ackIsError(ack: TcpAck): boolean {
  const response = ack.response?.toLowerCase();
  if (response === 'error') return true;
  if (response === 'success') return false;
  const status = ack.status?.toLowerCase();
  if (status === 'error' || status === 'failed') return true;
  return Boolean(ack.code ?? ack.error);
}

export function ackErrorCode(ack: TcpAck): string | null {
  const raw = ack.code ?? ack.error ?? (typeof ack.message === 'string' ? ack.message : null);
  return raw ? raw.slice(0, 120) : null;
}
