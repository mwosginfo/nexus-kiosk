import { z } from 'zod';

/**
 * Wire schemas for the Qtech queue-operations API, transcribed from the
 * "MWO-OWWA ↔ Qtech Queue System — Integration Response" (5 August 2026), §1.
 *
 * Only the two endpoints in that document exist here: POST /call and
 * GET /health. Nothing else is modelled, because nothing else is offered.
 */

export const CallRequestSchema = z.object({
  eventId: z.string().uuid(),
  ticketID: z.string().min(1).max(64),
  branchUUID: z.string().min(1),
  counterName: z.string().min(1),
  queueNo: z.string().min(1),
  silent: z.boolean().optional(),
  timestamp: z.string().min(1),
});
export type CallRequest = z.infer<typeof CallRequestSchema>;

/** Stable machine-readable error codes from §1. Business errors — never retried. */
export const QtechErrorCode = z.enum([
  'BRANCH_NOT_FOUND',
  'COUNTER_UNKNOWN',
  'VALIDATION_ERROR',
]);
export type QtechErrorCode = z.infer<typeof QtechErrorCode>;

export const CallSuccessMessageSchema = z.object({
  eventId: z.string().optional(),
  ticketID: z.string().optional(),
  queueNo: z.string().optional(),
  counterName: z.string().optional(),
  status: z.string().optional(),
  serverTime: z.string().optional(),
  duplicate: z.boolean().optional(),
});

/**
 * Deliberately lenient on the error branch. The document fixes the success
 * shape and the set of codes, but not the exact envelope an error uses, so we
 * accept a code at any of the plausible positions rather than failing to parse
 * a response that did tell us something useful.
 */
export const CallResponseSchema = z.object({
  response: z.string(),
  message: z.union([CallSuccessMessageSchema, z.string()]).optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  field: z.string().optional(),
});
export type CallResponse = z.infer<typeof CallResponseSchema>;

export function isSuccess(body: CallResponse): boolean {
  return body.response.toLowerCase() === 'success';
}

export function extractErrorCode(body: CallResponse): string | null {
  const candidates: readonly (string | undefined)[] = [
    body.code,
    body.error,
    typeof body.message === 'string' ? body.message : undefined,
    typeof body.message === 'object' && body.message !== null
      ? (body.message as { status?: string }).status
      : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = QtechErrorCode.safeParse(candidate.trim().toUpperCase());
    if (parsed.success) return parsed.data;
  }
  // Unknown but still an error — surface the raw string so it reaches the
  // health row rather than being flattened to "unknown".
  const raw = candidates.find((c) => typeof c === 'string' && c.length > 0);
  return raw ? raw.slice(0, 120) : null;
}

export function extractDuplicate(body: CallResponse): boolean {
  if (typeof body.message === 'object' && body.message !== null) {
    return (body.message as { duplicate?: boolean }).duplicate === true;
  }
  return false;
}
