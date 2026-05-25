import { z } from 'zod';

/**
 * Supabase `submissions` table — Accreditation flow.
 *
 * Per the Supabase-Reduction kiosk spec, the kiosk only needs the columns
 * required to route a scan (first-visit vs pickup) and print the ticket:
 * ref_code, the agency or principal name, status, and trans_status.
 */
export const SubmissionRowSchema = z.object({
  ref_code: z.string(),
  pra_name: z.string().nullable().optional(),
  p_name: z.string().nullable().optional(),
  trans_status: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
export type SubmissionRow = z.infer<typeof SubmissionRowSchema>;

/**
 * Accreditation eligibility is driven entirely by the `trans_status` column —
 * the accreditation workflow state the office maintains. The `status` column is
 * internal workflow noise (pending/received/closed/…) and is NOT consulted.
 *
 * There is no appointment_date gate: a submission is checkable for as long as
 * its trans_status sits in one of the actionable states below. The pickup set
 * is a superset (SUBMITTED, PROCESSED, OR_ISSUED) so that a returning client
 * can re-scan on any of the post-submission days until the OR is collected.
 *
 * Compare case-insensitively — the DB stores mixed case (`For Submission`,
 * `OR_ISSUED`, …); the service normalises before lookup.
 */

/** trans_status meaning the client is here to SUBMIT (first visit → arrived ticket). */
export const ACCREDITATION_FIRST_VISIT_TRANS = 'for submission';

/** trans_status values meaning the OR cycle is in progress (second visit → PICKUP ticket). */
export const ACCREDITATION_PICKUP_TRANS_SET: ReadonlySet<string> = new Set([
  'submitted',
  'processed',
  'or_issued',
]);
