import { getSupabase, getSupabaseWriter } from './supabase.client';
import type { AppointmentWithService } from '../schemas/appointment.schema';
import { generateRefCode, todaySGT, OWWA_SERVICE_ID } from '../lib/constants';

/**
 * Minimal select — only columns CONFIRMED to exist in Supabase.
 * NO FK join (services table may not have FK relationship configured).
 * Extra columns that might not exist (client_contact, appt_status) are excluded
 * from the main select and fetched separately if needed.
 */
const APPOINTMENT_FIELDS = `
  id, ref_code, service_id, appointment_date, start_time, end_time,
  status, client_fname, client_lname, client_mname,
  client_email, client_data, ticket_number,
  confirmed_at, staff_notes, created_at, updated_at
`;

/**
 * Look up appointment by ref_code ONLY — no date filter.
 * ref_code is unique, so date filtering only causes false negatives.
 */
export async function lookupByRefCode(
  refCode: string,
): Promise<AppointmentWithService | null> {
  const supabase = getSupabaseWriter();

  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .eq('ref_code', refCode.toUpperCase().trim())
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[appointment.lookupByRefCode] Supabase error:', error);
    throw new Error(`Appointment lookup failed: ${error.message}`);
  }
  if (!data) {
    console.warn('[appointment.lookupByRefCode] No match for ref_code:', refCode.toUpperCase().trim());
    return null;
  }

  console.log('[appointment.lookupByRefCode] Found:', data.id, data.ref_code, data.status);

  // Return raw data — no strict Zod parse that could throw on unexpected shapes
  return data as AppointmentWithService;
}

/** Look up appointments by phone number (client_data->mobile_no), optionally filtered by date */
export async function lookupByPhone(
  phone: string,
  date?: string
): Promise<readonly AppointmentWithService[]> {
  const supabase = getSupabaseWriter();
  const normalizedPhone = phone.trim();

  // Try client_contact first (may exist as a column), fall back to client_data JSONB
  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .or(`client_contact.eq.${normalizedPhone},client_data->>mobile_no.eq.${normalizedPhone}`)
    .in('status', ['pending', 'confirmed']);

  if (date) {
    query = query.eq('appointment_date', date);
  }

  const { data, error } = await query.order('appointment_date', { ascending: true }).limit(20);

  if (error) {
    console.error('[appointment.lookupByPhone] Supabase error:', error);
    // If the OR filter fails (client_contact column doesn't exist), try just client_data
    const fallbackQuery = supabase
      .from('appointments')
      .select(APPOINTMENT_FIELDS)
      .contains('client_data', { mobile_no: normalizedPhone })
      .in('status', ['pending', 'confirmed']);

    if (date) {
      fallbackQuery.eq('appointment_date', date);
    }

    const fallback = await fallbackQuery.order('appointment_date', { ascending: true }).limit(20);
    if (fallback.error) throw new Error(`Phone lookup failed: ${fallback.error.message}`);
    return (fallback.data ?? []) as readonly AppointmentWithService[];
  }

  return (data ?? []) as readonly AppointmentWithService[];
}

/** Mark appointment as arrived in Supabase */
export async function markArrived(appointmentId: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('appointments')
    .update({
      appt_status: 'ARRIVED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) {
    console.warn('[appointment.markArrived] Error (non-fatal):', error.message);
    // Non-fatal — the check-in can still proceed even if marking arrived fails
    // (appt_status column might not exist)
  }
}

/** Determine queue series from service_id */
export function getQueueSeries(serviceId: string): 'REGULAR' | 'OWWA' {
  return serviceId === OWWA_SERVICE_ID ? 'OWWA' : 'REGULAR';
}

/** Create a walk-in appointment in Supabase */
export async function createWalkInAppointment(data: {
  readonly fname: string;
  readonly lname: string;
  readonly email: string;
  readonly phone: string;
  readonly serviceSlug: string;
  readonly serviceId: string;
}): Promise<string> {
  const supabase = getSupabaseWriter();
  const now = new Date();
  const refCode = generateRefCode();

  const startTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const endDate = new Date(now.getTime() + 30 * 60 * 1000);
  const endTime = endDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // Walk-ins need a real slot_id (FK to weekly_slots) — grab any active slot for this service
  const { data: slot } = await supabase
    .from('weekly_slots')
    .select('id')
    .eq('service_id', data.serviceId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!slot) throw new Error('No active time slot found for this service. Cannot create walk-in.');

  const { data: inserted, error } = await supabase
    .from('appointments')
    .insert({
      ref_code: refCode,
      service_id: data.serviceId,
      slot_id: slot.id as string,
      appointment_date: todaySGT(),
      start_time: startTime,
      end_time: endTime,
      status: 'confirmed',
      client_fname: data.fname.trim(),
      client_lname: data.lname.trim(),
      client_mname: '',
      client_email: data.email.trim().toLowerCase(),
      client_data: { mobile_no: data.phone.trim() },
      confirmed_at: now.toISOString(),
    })
    .select('ref_code')
    .single();

  if (error) throw new Error(`Walk-in creation failed: ${error.message}`);
  return inserted.ref_code as string;
}
