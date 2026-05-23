/**
 * Accreditation submission lookup + eligibility.
 *
 * Eligibility is driven by the `trans_status` column only (no appointment_date
 * gate):
 *   1. First visit — trans_status === 'For Submission'
 *      → kiosk inserts a fresh ACCREDITATION kiosk_checkins row.
 *   2. Pickup      — trans_status === 'OR_ISSUED'
 *      → kiosk inserts a PICKUP - ACCREDITATION kiosk_checkins row.
 * Anything else is ineligible. Same-day duplicate issuance is prevented by the
 * kiosk_checkins dedup check, so the kiosk does not mutate the submission row.
 */

import { getSupabaseWriter } from './supabase.client';
import {
  ACCREDITATION_FIRST_VISIT_TRANS,
  ACCREDITATION_PICKUP_TRANS,
  type SubmissionRow,
} from '../schemas/submission.schema';

const SUBMISSION_FIELDS = 'ref_code, pra_name, p_name, trans_status, status, created_at';

/** Look up a submission by its reference code (e.g. "HSW2601-FM00CD"). */
export async function lookupByRefCode(refCode: string): Promise<SubmissionRow | null> {
  const supabase = getSupabaseWriter();
  const { data, error } = await supabase
    .from('submissions')
    .select(SUBMISSION_FIELDS)
    .eq('ref_code', refCode.trim())
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[submission.lookupByRefCode] Error:', error.message);
    return null;
  }
  return data as SubmissionRow | null;
}

function normalizedTransStatus(row: SubmissionRow): string | null {
  const raw = row.trans_status ?? null;
  return raw ? raw.toString().trim().toLowerCase() : null;
}

/** First-visit eligible — client is here to submit (trans_status 'For Submission'). */
export function isFirstVisitEligible(submission: SubmissionRow): boolean {
  return normalizedTransStatus(submission) === ACCREDITATION_FIRST_VISIT_TRANS;
}

/** Pickup eligible — OR is ready (trans_status 'OR_ISSUED'). */
export function isPickupEligible(submission: SubmissionRow): boolean {
  return normalizedTransStatus(submission) === ACCREDITATION_PICKUP_TRANS;
}

/** Ineligible — trans_status is neither actionable state, so reject the scan. */
export function isBlocked(submission: SubmissionRow): boolean {
  return !isFirstVisitEligible(submission) && !isPickupEligible(submission);
}

/** Display name printed on the ticket. */
export function resolveSubmissionName(submission: SubmissionRow): string {
  return (submission.pra_name?.trim() || submission.p_name?.trim() || '').trim();
}
