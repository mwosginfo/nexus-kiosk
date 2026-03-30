/**
 * Queue Service — generates queue numbers via Supabase RPC and writes to kiosk_checkins.
 *
 * Uses next_queue_number() RPC with pg_advisory_xact_lock for safe concurrency.
 * Queue numbers reset daily (SGT).
 */

import { getSupabaseWriter } from './supabase.client';
import { todaySGT, formatQueueDisplay, getStartNumber, generateRefCode } from '../lib/constants';

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
}

// ─── Duplicate check ───────────────────────────────────────────────────────

export interface DuplicateResult {
  readonly isDuplicate: true;
  readonly displayNumber: string;
  readonly queueNumber: number;
}

export async function checkDuplicate(
  refCode: string,
): Promise<DuplicateResult | null> {
  const supabase = getSupabaseWriter();
  const today = todaySGT();

  const { data, error } = await supabase
    .from('kiosk_checkins')
    .select('id, queue_number, display_number')
    .eq('ref_code', refCode)
    .eq('queue_date', today)
    .neq('status', 'FAILED')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[queue.checkDuplicate] Error:', error.message);
    return null;
  }

  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    isDuplicate: true,
    displayNumber: row.display_number as string,
    queueNumber: row.queue_number as number,
  };
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
 */
export async function checkinAndAssignQueue(data: CheckinData): Promise<QueueAssignment> {
  const supabase = getSupabaseWriter();
  const today = todaySGT();

  const queueNumber = await getNextQueueNumber(data.queueSeries);
  const displayNumber = formatQueueDisplay(queueNumber, data.queueSeries);

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
    });

  if (error) throw new Error(`Check-in failed: ${error.message}`);

  return { queueNumber, displayNumber, queueSeries: data.queueSeries };
}

// ─── OWWA quick queue (no client details) ──────────────────────────────────

/**
 * Generate the next OWWA queue number with no client details.
 * Inserts a minimal row into kiosk_checkins.
 */
export async function owwaQuickQueue(): Promise<QueueAssignment> {
  const refCode = `OWWA-${generateRefCode()}`;
  return checkinAndAssignQueue({
    refCode,
    appointmentType: 'WALKIN',
    queueSeries: 'OWWA',
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
 * Register a walk-in client and assign a WALKIN_REGULAR queue number.
 * Writes directly to kiosk_checkins with W600 series.
 */
export async function walkInCheckin(data: WalkInData): Promise<QueueAssignment> {
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
    });

  if (error) throw new Error(`Walk-in check-in failed: ${error.message}`);

  return { queueNumber, displayNumber, queueSeries: 'WALKIN_REGULAR' };
}
