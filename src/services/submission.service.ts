/**
 * Accreditation submission lookup + arrival.
 *
 * Two scan moments are supported:
 *   1. First visit  — submissions.status in {pending, for_submission, confirmed}
 *      → kiosk inserts kiosk_checkins (ACCREDITATION first-visit) and flips
 *        submissions.status to 'arrived'.
 *   2. Pickup       — submissions.status in {submitted, or_issued}, OR the
 *      legacy trans_status === 'For Submission' signal that Nexus has not
 *      yet migrated away from.
 */

import { getSupabaseWriter } from './supabase.client';
import {
  ACCREDITATION_BLOCKED_STATUSES,
  ACCREDITATION_FIRST_VISIT_STATUSES,
  ACCREDITATION_PICKUP_STATUSES,
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

function normalizedStatus(row: SubmissionRow): string | null {
  const raw = row.status ?? null;
  return raw ? raw.toString().toLowerCase() : null;
}

/** Blocked terminal state — reject the scan. */
export function isBlocked(submission: SubmissionRow): boolean {
  const s = normalizedStatus(submission);
  if (!s) return false;
  return (ACCREDITATION_BLOCKED_STATUSES as readonly string[]).includes(s);
}

/** First-visit eligible — client has not yet been to the office for this submission. */
export function isFirstVisitEligible(submission: SubmissionRow): boolean {
  const s = normalizedStatus(submission);
  if (!s) {
    // Some legacy rows lack the new `status` column entirely; treat as pending.
    return submission.trans_status !== ACCREDITATION_PICKUP_TRANS_STATUS;
  }
  return (ACCREDITATION_FIRST_VISIT_STATUSES as readonly string[]).includes(s);
}

/**
 * Pickup eligible — second visit. Recognises both the new status values and
 * the legacy `trans_status === 'For Submission'` signal so the kiosk keeps
 * working during the Nexus rollout window.
 */
export function isPickupEligible(submission: SubmissionRow): boolean {
  const s = normalizedStatus(submission);
  if (s && (ACCREDITATION_PICKUP_STATUSES as readonly string[]).includes(s)) {
    return true;
  }
  return submission.trans_status === ACCREDITATION_PICKUP_TRANS_STATUS;
}

/** Display name printed on the ticket. */
export function resolveSubmissionName(submission: SubmissionRow): string {
  return (submission.pra_name?.trim() || submission.p_name?.trim() || '').trim();
}

/**
 * Flip `submissions.status` to 'arrived' on first-visit check-in.
 * Guarded against terminal/non-eligible states so retries are safe.
 * Fire-and-forget — check-in succeeds even if the update fails.
 */
export async function markArrived(refCode: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('submissions')
    .update({ status: 'arrived' })
    .eq('ref_code', refCode.trim())
    .in('status', [...ACCREDITATION_FIRST_VISIT_STATUSES]);

  if (error) {
    console.warn('[submission.markArrived] Error (non-fatal):', error.message);
  }
}
