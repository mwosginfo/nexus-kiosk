/**
 * Queue Service — generates queue numbers via Supabase RPC and writes to kiosk_checkins.
 *
 * Uses next_queue_number() RPC with pg_advisory_xact_lock for safe concurrency.
 * Queue numbers reset daily (SGT).
 *
 * Status convention:
 *   This app always writes status='WAITING' because it fully resolves
 *   the service, generates the queue number, and builds the complete entry.
 *   The Nexus kiosk-bridge only processes PENDING entries (for simpler clients
 *   that cannot resolve services). Since we do all that, WAITING is correct.
 *
 * Priority:
 *   2 = WALKIN regular (skilled-cv / mdw-cv walk-ins)
 *   3 = APPOINTMENT / FRA / OWWA walk-in
 *   Lower number = higher priority. We always set explicitly.
 */

import { getSupabaseWriter } from './supabase.client';
import { todaySGT, formatQueueDisplay, getStartNumber, generateRefCode } from '../lib/constants';

// ─── Rate Limiting ─────────────────────────────────────────────────────────

const rateLimitState = {
  timestamps: [] as number[],
  maxRequests: 10,
  windowMs: 60_000, // 1 minute
};

function checkRateLimit(): boolean {
  const now = Date.now();
  rateLimitState.timestamps = rateLimitState.timestamps.filter(
    (t) => now - t < rateLimitState.windowMs,
  );
  if (rateLimitState.timestamps.length >= rateLimitState.maxRequests) {
    return false;
  }
  rateLimitState.timestamps.push(now);
  return true;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface QueueAssignment {
  readonly queueNumber: number;
  readonly displayNumber: string;
  readonly queueSeries: string;
}

export interface CheckinData {
  readonly refCode: string;
  readonly appointmentType: 'APPOINTMENT' | 'FRA' | 'WALKIN';
  readonly queueSeries: string;
  readonly serviceType: string;
  readonly clientName: string;
  readonly clientEmail?: string;
  readonly appointmentId?: string;
  readonly transactionRef?: string;
  /** Optional tag — e.g., "PICKUP", "DEFERRED" — for receptionist tracking */
  readonly remarks?: string;
}

// ─── Duplicate check ───────────────────────────────────────────────────────

export interface DuplicateResult {
  readonly isDuplicate: true;
  readonly displayNumber: string;
  readonly queueNumber: number;
  readonly isDeferred: boolean;
}

/**
 * Check for existing check-in today.
 * Excludes FAILED entries (retryable) and DEFERRED entries (re-entry allowed).
 * For non-same-day scans, no duplicate exists by definition (different queue_date).
 */
export async function checkDuplicate(
  refCode: string,
): Promise<DuplicateResult | null> {
  const supabase = getSupabaseWriter();
  const today = todaySGT();

  // First check for active (non-terminal) entries today
  const { data, error } = await supabase
    .from('kiosk_checkins')
    .select('id, queue_number, display_number, status')
    .eq('ref_code', refCode)
    .eq('queue_date', today)
    .not('status', 'in', '("FAILED","DEFERRED")')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[queue.checkDuplicate] Error:', error.message);
    return null;
  }

  if (data) {
    const row = data as Record<string, unknown>;
    return {
      isDuplicate: true,
      displayNumber: row.display_number as string,
      queueNumber: row.queue_number as number,
      isDeferred: false,
    };
  }

  // Check if there's a deferred entry — allow re-scan but inform caller
  const { data: deferred } = await supabase
    .from('kiosk_checkins')
    .select('id, queue_number, display_number, status')
    .eq('ref_code', refCode)
    .eq('queue_date', today)
    .eq('status', 'DEFERRED')
    .limit(1)
    .maybeSingle();

  if (deferred) {
    // Deferred entries are allowed to re-check-in (new queue number)
    return null;
  }

  return null;
}

// ─── Queue number generation via RPC ───────────────────────────────────────

async function getNextQueueNumber(queueSeries: string): Promise<number> {
  const supabase = getSupabaseWriter();
  const today = todaySGT();
  const startNumber = getStartNumber(queueSeries);

  const { data, error } = await supabase.rpc('next_queue_number', {
    p_queue_date: today,
    p_queue_series: queueSeries,
    p_start_number: startNumber,
  });

  if (error) throw new Error(`Queue number generation failed: ${error.message}`);
  if (typeof data !== 'number') throw new Error('Queue number generation returned invalid data');

  return data;
}

// ─── Main check-in function ────────────────────────────────────────────────

/**
 * Generate a queue number and insert a row into kiosk_checkins.
 * Works for appointments, FRA, walk-ins, and OWWA quick queue.
 *
 * Priority and call_count are always set explicitly to match Nexus backend
 * addToQueue() behavior. Status is always WAITING (see module header comment).
 */
export async function checkinAndAssignQueue(data: CheckinData): Promise<QueueAssignment> {
  if (!checkRateLimit()) {
    throw new Error('Too many check-ins in a short time. Please wait a moment and try again.');
  }

  const supabase = getSupabaseWriter();
  const today = todaySGT();

  const queueNumber = await getNextQueueNumber(data.queueSeries);
  const displayNumber = formatQueueDisplay(queueNumber, data.queueSeries);

  // Priority: 2 = regular walk-in, 3 = appointment/FRA/OWWA walk-in
  const priority = data.appointmentType === 'APPOINTMENT' || data.appointmentType === 'FRA' ? 3
    : data.queueSeries === 'WALKIN_OWWA' ? 3
    : 2;

  const { error } = await supabase
    .from('kiosk_checkins')
    .insert({
      ref_code: data.refCode,
      appointment_type: data.appointmentType,
      queue_number: queueNumber,
      display_number: displayNumber,
      queue_series: data.queueSeries,
      service_type: data.serviceType,
      status: 'WAITING',
      client_name: data.clientName || null,
      client_email: data.clientEmail ?? null,
      appointment_id: data.appointmentId ?? null,
      transaction_ref: data.transactionRef ?? data.refCode,
      queue_date: today,
      priority,
      call_count: 0,
      remarks: data.remarks ?? null,
    });

  if (error) throw new Error(`Check-in failed: ${error.message}`);

  return { queueNumber, displayNumber, queueSeries: data.queueSeries };
}

// ─── OWWA quick queue (no client details) ──────────────────────────────────

/**
 * Generate the next OWWA walk-in queue number (W900 series).
 * No client details needed. Priority 3.
 */
export async function owwaQuickQueue(): Promise<QueueAssignment> {
  const refCode = `OWWA-${generateRefCode()}`;
  return checkinAndAssignQueue({
    refCode,
    appointmentType: 'WALKIN',
    queueSeries: 'WALKIN_OWWA',
    serviceType: 'OWWA',
    clientName: '',
  });
}

// ─── Walk-in registration (skilled-cv / mdw-cv) ───────────────────────────

export interface WalkInData {
  readonly fname: string;
  readonly lname: string;
  readonly mname?: string;
  readonly gender: string;
  readonly email: string;
  readonly ofwTrans: string;
  readonly serviceType: 'SKILLED_CV' | 'MDW_CV';
}

/**
 * Register a walk-in client and assign a WALKIN_REGULAR queue number (W600 series).
 * Regular walk-ins get priority 2.
 */
export async function walkInCheckin(data: WalkInData): Promise<QueueAssignment> {
  if (!checkRateLimit()) {
    throw new Error('Too many check-ins in a short time. Please wait a moment and try again.');
  }

  const refCode = `W-${generateRefCode()}`;
  const clientName = [data.fname, data.mname, data.lname].filter(Boolean).join(' ');

  const supabase = getSupabaseWriter();
  const today = todaySGT();

  const queueNumber = await getNextQueueNumber('WALKIN_REGULAR');
  const displayNumber = formatQueueDisplay(queueNumber, 'WALKIN_REGULAR');

  const { error } = await supabase
    .from('kiosk_checkins')
    .insert({
      ref_code: refCode,
      appointment_type: 'WALKIN',
      queue_number: queueNumber,
      display_number: displayNumber,
      queue_series: 'WALKIN_REGULAR',
      service_type: data.serviceType,
      status: 'WAITING',
      client_name: clientName,
      client_email: data.email.trim().toLowerCase() || null,
      appointment_id: null,
      transaction_ref: refCode,
      queue_date: today,
      priority: 2,
      call_count: 0,
    });

  if (error) throw new Error(`Walk-in check-in failed: ${error.message}`);

  return { queueNumber, displayNumber, queueSeries: 'WALKIN_REGULAR' };
}
