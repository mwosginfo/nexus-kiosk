/**
 * FRA Service — lookup and mark arrived only.
 * This app does NOT create FRA registrations or modify worker data.
 *
 * READ operations use the anon client (least privilege).
 * WRITE operations (markArrived) use the service role client.
 *
 * FRA registrations can be checked in from appointments within the past 14 days
 * (not just today). Agencies sometimes check in for prior-date appointments.
 * Future appointments are NOT allowed — only today and 14 days back.
 */

import { getSupabaseWriter } from './supabase.client';
import { todaySGT } from '../lib/constants';
import type { FraRegistrationRow } from '../schemas/fra.schema';

const FRA_FIELDS = `
  id, transaction_ref, appointment_date, pra, fra,
  agency_email, agency_personnel, status,
  arrived_at, staff_notes, created_at, updated_at
`;

/**
 * Calculate date 14 days ago in SGT (YYYY-MM-DD).
 */
function fourteenDaysAgoSGT(): string {
  const now = new Date();
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  sgt.setUTCDate(sgt.getUTCDate() - 14);
  return sgt.toISOString().slice(0, 10);
}

/**
 * Look up FRA registration by transaction_ref within the past 14 days.
 * Excludes cancelled registrations.
 * Only looks back 14 days (no future appointments allowed).
 */
export async function lookupByRef(
  transactionRef: string,
): Promise<FraRegistrationRow | null> {
  const supabase = getSupabaseWriter(); // service role required (RLS may restrict anon)
  const today = todaySGT();
  const cutoffDate = fourteenDaysAgoSGT();

  const { data, error } = await supabase
    .from('fra_registrations')
    .select(FRA_FIELDS)
    .eq('transaction_ref', transactionRef.trim())
    .gte('appointment_date', cutoffDate)
    .lte('appointment_date', today)
    .neq('status', 'cancelled')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[fra.lookupByRef] Supabase error:', error);
    throw new Error(`FRA lookup failed: ${error.message}`);
  }

  return data as FraRegistrationRow | null;
}

/** Mark FRA registration as arrived (fire-and-forget, non-fatal) */
export async function markArrived(fraId: string): Promise<void> {
  const supabase = getSupabaseWriter(); // WRITE: service role key
  const { error } = await supabase
    .from('fra_registrations')
    .update({
      status: 'arrived',
      arrived_at: new Date().toISOString(),
    })
    .eq('id', fraId);

  if (error) {
    console.warn('[fra.markArrived] Error (non-fatal):', error.message);
  }
}
