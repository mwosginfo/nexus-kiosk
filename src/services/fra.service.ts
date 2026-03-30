/**
 * FRA Service — lookup and mark arrived only.
 * This app does NOT create FRA registrations or modify worker data.
 */

import { getSupabaseWriter } from './supabase.client';
import type { FraRegistrationRow } from '../schemas/fra.schema';

const FRA_FIELDS = `
  id, transaction_ref, appointment_date, pra, fra,
  agency_email, agency_personnel, status,
  arrived_at, staff_notes, created_at, updated_at
`;

/** Look up FRA registration by transaction_ref */
export async function lookupByRef(
  transactionRef: string,
): Promise<FraRegistrationRow | null> {
  const supabase = getSupabaseWriter();

  const { data, error } = await supabase
    .from('fra_registrations')
    .select(FRA_FIELDS)
    .eq('transaction_ref', transactionRef.trim())
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
  const supabase = getSupabaseWriter();
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
