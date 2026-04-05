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
import type { FraRegistrationRow, FraGroup } from '../schemas/fra.schema';

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

/**
 * Browse FRA registrations by date, grouped by unique transaction_ref.
 * Returns one FraGroup per transaction_ref with contract counts.
 * Each group represents a batch — checking in one checks in ALL contracts.
 */
export async function browseFra(
  date: string,
  search?: string,
): Promise<readonly FraGroup[]> {
  const supabase = getSupabaseWriter();

  let query = supabase
    .from('fra_registrations')
    .select(FRA_FIELDS)
    .eq('appointment_date', date);

  if (search && search.trim()) {
    const q = search.trim();
    query = query.or(`fra.ilike.%${q}%,transaction_ref.ilike.%${q}%`);
  }

  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw new Error(`FRA browse failed: ${error.message}`);

  const rows = (data ?? []) as readonly FraRegistrationRow[];

  // Group by transaction_ref
  const groups = new Map<string, FraRegistrationRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.transaction_ref);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.transaction_ref, [row]);
    }
  }

  // Convert to FraGroup[]
  const result: FraGroup[] = [];
  for (const [, contracts] of groups) {
    const first = contracts[0]!;
    result.push({
      row: first,
      contractCount: contracts.length,
      pendingCount: contracts.filter((c) => c.status === 'pending').length,
      arrivedCount: contracts.filter((c) => c.status === 'arrived').length,
    });
  }

  return result;
}

/**
 * Mark ALL pending FRA contracts in a batch as arrived.
 * Updates by transaction_ref (not individual id) to match Nexus behavior.
 * Fire-and-forget — check-in succeeds even if this update fails.
 */
export async function markArrived(transactionRef: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('fra_registrations')
    .update({
      status: 'arrived',
      arrived_at: new Date().toISOString(),
    })
    .eq('transaction_ref', transactionRef)
    .eq('status', 'pending');

  if (error) {
    console.warn('[fra.markArrived] Error (non-fatal):', error.message);
  }
}
