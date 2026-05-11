/**
 * Accreditation submission lookup. Used only for the kiosk pickup flow.
 *
 * Submissions never enter the kiosk queue as fresh check-ins — clients first
 * register through the Accreditation portal, and only return to pick up their
 * processed submission when `trans_status` reaches the configured value.
 */

import { getSupabaseWriter } from './supabase.client';
import {
  ACCREDITATION_PICKUP_TRANS_STATUS,
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

/**
 * True when the submission is ready for the client to pick up.
 * Accreditation has no kiosk queue entry until this point — the pickup ticket
 * is the first kiosk_checkins row this submission ever produces.
 */
export function isPickupEligible(submission: SubmissionRow): boolean {
  return submission.trans_status === ACCREDITATION_PICKUP_TRANS_STATUS;
}

/** Resolve the display name shown on the pickup ticket. */
export function resolveSubmissionName(submission: SubmissionRow): string {
  return (submission.pra_name?.trim() || submission.p_name?.trim() || '').trim();
}
