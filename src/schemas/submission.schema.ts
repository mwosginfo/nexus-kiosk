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
 * Legacy pickup signal — historically the kiosk recognised pickup via
 * `trans_status === 'For Submission'`. Kept until the Nexus rollout finishes
 * migrating accreditation rows to the new `status` model.
 */
export const ACCREDITATION_PICKUP_TRANS_STATUS = 'For Submission';

/**
 * Statuses that allow a first-visit (arrived) check-in.
 * Matches the Supabase-Reduction kiosk spec §3.4.
 */
export const ACCREDITATION_FIRST_VISIT_STATUSES = [
  'pending',
  'for_submission',
  'confirmed',
] as const;

/**
 * Statuses that indicate the submission is ready for the client to pick up
 * (second visit, after OR issuance or evaluator submission).
 */
export const ACCREDITATION_PICKUP_STATUSES = [
  'submitted',
  'or_issued',
] as const;

/** Terminal statuses — kiosk rejects the scan with a friendly message. */
export const ACCREDITATION_BLOCKED_STATUSES = [
  'released',
  'cancelled',
] as const;
