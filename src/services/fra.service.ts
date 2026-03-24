import { getSupabase, getSupabaseWriter } from './supabase.client';
import type { FraRegistrationRow } from '../schemas/fra.schema';
import { todaySGT } from '../lib/constants';

const FRA_FIELDS = `
  id, transaction_ref, appointment_date, pra, fra,
  agency_email, agency_personnel, workers, status,
  arrived_at, completed_at, cancelled_at, staff_notes,
  created_at, updated_at
`;

/** Look up FRA registration by transaction_ref ONLY — no date filter (ref is unique) */
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
  if (!data) {
    console.warn('[fra.lookupByRef] No match for transaction_ref:', transactionRef.trim());
    return null;
  }

  console.log('[fra.lookupByRef] Found:', data.id, data.transaction_ref, data.status);
  return data as FraRegistrationRow;
}

// Phone search disabled for FRA — use transaction_ref only

/** Mark FRA registration as arrived in Supabase */
export async function markArrived(fraId: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('fra_registrations')
    .update({
      status: 'arrived',
      arrived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', fraId);

  if (error) {
    console.warn('[fra.markArrived] Error (non-fatal):', error.message);
  }
}

/** Create a walk-in FRA registration in Supabase */
export async function createWalkInFra(data: {
  readonly agencyName: string;
  readonly email: string;
  readonly phone: string;
  readonly personnel: string;
}): Promise<string> {
  const supabase = getSupabaseWriter();
  const transRef = `WALKIN-${Date.now()}`;

  const { error } = await supabase
    .from('fra_registrations')
    .insert({
      transaction_ref: transRef,
      appointment_date: todaySGT(),
      pra: '',
      fra: data.agencyName.trim(),
      agency_email: data.email.trim().toLowerCase(),
      agency_personnel: data.personnel.trim(),
      workers: [],
      status: 'pending',
    });

  if (error) throw new Error(`FRA walk-in creation failed: ${error.message}`);
  return transRef;
}
