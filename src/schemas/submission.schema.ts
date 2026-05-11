import { z } from 'zod';

/**
 * Supabase `submissions` table — Accreditation flow.
 *
 * Per Nexus backend findings, the kiosk only needs the columns required to
 * validate pickup eligibility and print the ticket: ref_code, the agency or
 * principal name, and the trans_status filter.
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
 * Pickup is allowed when `trans_status === 'For Submission'`
 * (per Migrant Workers Office accreditation workflow).
 */
export const ACCREDITATION_PICKUP_TRANS_STATUS = 'For Submission';
