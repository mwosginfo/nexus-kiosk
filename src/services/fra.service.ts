/**
 * FRA Service — lookup, group analysis, and status updates.
 *
 * Receptionist mode supports any date (future/today/past).
 * Kiosk mode (strict): today + 14 days back only, no future.
 */

import { getSupabaseWriter } from './supabase.client';
import { todaySGT } from '../lib/constants';
import type { FraRegistrationRow, FraGroup } from '../schemas/fra.schema';

const FRA_FIELDS = `
  id, transaction_ref, appointment_date, pra, fra,
  agency_email, agency_personnel, status,
  arrived_at, staff_notes, created_at, updated_at
`;

/** Calculate date 14 days ago in SGT (YYYY-MM-DD). */
function fourteenDaysAgoSGT(): string {
  const now = new Date();
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  sgt.setUTCDate(sgt.getUTCDate() - 14);
  return sgt.toISOString().slice(0, 10);
}

export interface LookupOptions {
  /** Strict mode (kiosk): today + 14 days back, no future. Default true. */
  readonly strict?: boolean;
}

/**
 * Look up FRA registration by transaction_ref.
 * Excludes cancelled registrations.
 * Strict mode (default): today + 14 days back only.
 * Permissive mode: any date.
 */
export async function lookupByRef(
  transactionRef: string,
  options: LookupOptions = {},
): Promise<FraRegistrationRow | null> {
  const supabase = getSupabaseWriter();
  const strict = options.strict !== false;

  let query = supabase
    .from('fra_registrations')
    .select(FRA_FIELDS)
    .eq('transaction_ref', transactionRef.trim())
    .neq('status', 'cancelled');

  if (strict) {
    const today = todaySGT();
    const cutoffDate = fourteenDaysAgoSGT();
    query = query.gte('appointment_date', cutoffDate).lte('appointment_date', today);
  }

  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[fra.lookupByRef] Supabase error:', error);
    throw new Error(`FRA lookup failed: ${error.message}`);
  }

  return data as FraRegistrationRow | null;
}

/**
 * Get ALL contracts in a transaction_ref group.
 * Used to analyze pickup/deferred state for receptionist mode.
 */
export async function getGroupContracts(
  transactionRef: string,
): Promise<readonly FraRegistrationRow[]> {
  const supabase = getSupabaseWriter();
  const { data, error } = await supabase
    .from('fra_registrations')
    .select(FRA_FIELDS)
    .eq('transaction_ref', transactionRef);

  if (error) throw new Error(`Get group contracts failed: ${error.message}`);
  return (data ?? []) as readonly FraRegistrationRow[];
}

/**
 * Browse FRA registrations by date, grouped by unique transaction_ref.
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

  const groups = new Map<string, FraRegistrationRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.transaction_ref);
    if (existing) existing.push(row);
    else groups.set(row.transaction_ref, [row]);
  }

  const result: FraGroup[] = [];
  for (const [, contracts] of groups) {
    result.push({
      row: contracts[0]!,
      contractCount: contracts.length,
      pendingCount: contracts.filter((c) => c.status === 'pending').length,
      arrivedCount: contracts.filter((c) => c.status === 'arrived').length,
    });
  }

  return result;
}

// ─── Group analysis ────────────────────────────────────────────────────────

export interface FraGroupAnalysis {
  readonly all: readonly FraRegistrationRow[];
  /** status === 'completed' — ready for pickup */
  readonly pickupContracts: readonly FraRegistrationRow[];
  /** status === 'arrived' AND staff_notes IS NOT NULL — deferred */
  readonly deferredContracts: readonly FraRegistrationRow[];
  /** Everything else (pending, arrived without notes, picked-up, etc.) */
  readonly otherContracts: readonly FraRegistrationRow[];
}

/**
 * Categorize FRA contracts within a group.
 *  - pickup    = status='completed'
 *  - deferred  = status='arrived' AND staff_notes is non-empty
 *  - other     = anything else
 */
export function analyzeFraGroup(
  contracts: readonly FraRegistrationRow[],
): FraGroupAnalysis {
  const pickup: FraRegistrationRow[] = [];
  const deferred: FraRegistrationRow[] = [];
  const other: FraRegistrationRow[] = [];
  for (const c of contracts) {
    if (c.status === 'completed') pickup.push(c);
    else if (c.status === 'arrived' && c.staff_notes && c.staff_notes.trim().length > 0) deferred.push(c);
    else other.push(c);
  }
  return { all: contracts, pickupContracts: pickup, deferredContracts: deferred, otherContracts: other };
}

// ─── Status updates ────────────────────────────────────────────────────────

/** Mark ALL pending FRA contracts in a batch as arrived (used for normal check-in). */
export async function markArrived(transactionRef: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('fra_registrations')
    .update({ status: 'arrived', arrived_at: new Date().toISOString() })
    .eq('transaction_ref', transactionRef)
    .eq('status', 'pending');

  if (error) console.warn('[fra.markArrived] Error (non-fatal):', error.message);
}

/** Mark a set of contracts as picked-up (for FRA pickup flow). */
export async function markPickedUp(ids: ReadonlyArray<string>): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('fra_registrations')
    .update({ status: 'picked-up' })
    .in('id', [...ids]);

  if (error) console.warn('[fra.markPickedUp] Error (non-fatal):', error.message);
}

/** Clear staff_notes for a set of contracts (for FRA deferred re-checkin). */
export async function clearStaffNotes(ids: ReadonlyArray<string>): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('fra_registrations')
    .update({ staff_notes: null })
    .in('id', [...ids]);

  if (error) console.warn('[fra.clearStaffNotes] Error (non-fatal):', error.message);
}
