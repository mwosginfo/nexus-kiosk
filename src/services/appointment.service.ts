/**
 * Appointment Service — lookups + mark arrived on check-in.
 */

import { getSupabaseWriter } from './supabase.client';
import type { AppointmentWithService } from '../schemas/appointment.schema';
import { todaySGT, SLUG_MAP, resolveQueueSeries } from '../lib/constants';

const APPOINTMENT_FIELDS = `
  id, ref_code, service_id, appointment_date, start_time, end_time,
  status, ofw_lname, ofw_fname, ofw_mname,
  client_email, client_contact, client_data,
  appt_status, p_name, ofw_visa, ofw_position, ofw_trans, ofw_gender,
  confirmed_at, staff_notes, created_at, updated_at
`;

/** Look up appointment by ref_code (unique — no date filter). */
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

  if (error) throw new Error(`Appointment lookup failed: ${error.message}`);
  return data as AppointmentWithService | null;
}

/** Look up appointments by phone number, optionally filtered by date */
export async function lookupByPhone(
  phone: string,
  date?: string,
): Promise<readonly AppointmentWithService[]> {
  const supabase = getSupabaseWriter();
  const normalizedPhone = phone.trim();

  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .or(`client_contact.eq.${normalizedPhone},client_data->>mobile_no.eq.${normalizedPhone}`)
    .in('status', ['pending', 'confirmed']);

  if (date) query = query.eq('appointment_date', date);

  const { data, error } = await query.order('appointment_date', { ascending: true }).limit(20);

  if (error) {
    // Fallback: try just client_data
    const fallback = await supabase
      .from('appointments')
      .select(APPOINTMENT_FIELDS)
      .contains('client_data', { mobile_no: normalizedPhone })
      .in('status', ['pending', 'confirmed'])
      .order('appointment_date', { ascending: true })
      .limit(20);

    if (fallback.error) throw new Error(`Phone lookup failed: ${fallback.error.message}`);
    return (fallback.data ?? []) as readonly AppointmentWithService[];
  }

  return (data ?? []) as readonly AppointmentWithService[];
}

/**
 * Browse appointments by date with optional name/email search.
 * Used by receptionist mode to view all appointments for a given date.
 */
export async function browseAppointments(
  date: string,
  search?: string,
): Promise<readonly AppointmentWithService[]> {
  const supabase = getSupabaseWriter();

  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_FIELDS)
    .eq('appointment_date', date);

  if (search && search.trim()) {
    const q = search.trim();
    // Search by name (fname/lname) or email — use ilike for case-insensitive
    query = query.or(
      `ofw_fname.ilike.%${q}%,ofw_lname.ilike.%${q}%,client_email.ilike.%${q}%`,
    );
  }

  const { data, error } = await query
    .order('start_time', { ascending: true })
    .limit(100);

  if (error) throw new Error(`Browse failed: ${error.message}`);
  return (data ?? []) as readonly AppointmentWithService[];
}

// ─── Validation ────────────────────────────────────────────────────────────

export type CheckinValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Validate an appointment for check-in (date + status).
 */
export function validateAppointment(appointment: AppointmentWithService): CheckinValidation {
  const rejected: ReadonlyArray<string> = ['cancelled', 'completed', 'no_show'];
  if (rejected.includes(appointment.status)) {
    return {
      ok: false,
      message: `This appointment is ${appointment.status} and cannot be checked in.`,
    };
  }

  const today = todaySGT();
  if (appointment.appointment_date !== today) {
    return {
      ok: false,
      message: `Appointment is for ${appointment.appointment_date}, not today.`,
    };
  }

  return { ok: true };
}

// ─── Mark arrived (fire-and-forget, non-fatal) ─────────────────────────────

/**
 * Update appt_status to 'ARRIVED' after successful check-in.
 * Uses the same column Nexus backend uses (appt_status, not status).
 * Fire-and-forget — check-in succeeds even if this update fails.
 */
export async function markArrived(appointmentId: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('appointments')
    .update({ appt_status: 'ARRIVED' })
    .eq('id', appointmentId);

  if (error) {
    console.warn('[appointment.markArrived] Error (non-fatal):', error.message);
  }
}

/**
 * Transition a deferred appointment back to ARRIVED on re-check-in.
 * Clears staff_notes so the client can be deferred again later if needed.
 */
export async function markArrivedFromDeferred(appointmentId: string): Promise<void> {
  const supabase = getSupabaseWriter();
  const { error } = await supabase
    .from('appointments')
    .update({ appt_status: 'ARRIVED', staff_notes: null })
    .eq('id', appointmentId);

  if (error) {
    console.warn('[appointment.markArrivedFromDeferred] Error (non-fatal):', error.message);
  }
}

// ─── Service slug lookup ───────────────────────────────────────────────────

export async function lookupServiceInfo(
  serviceId: string,
): Promise<{ series: string; serviceType: string }> {
  const supabase = getSupabaseWriter();

  const { data, error } = await supabase
    .from('services')
    .select('slug')
    .eq('id', serviceId)
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    const slug = (data as Record<string, unknown>).slug as string;
    const mapping = SLUG_MAP[slug];
    if (mapping) return mapping;
  }

  return resolveQueueSeries(serviceId);
}
