import { z } from 'zod';

/** Supabase appointments table row — matches AgencyHire schema exactly */
export const AppointmentRowSchema = z.object({
  id: z.string().uuid(),
  ref_code: z.string(),
  service_id: z.string().uuid(),
  appointment_date: z.string(),
  start_time: z.string(),
  end_time: z.string().nullable(),
  status: z.string(),
  appt_status: z.string().nullable().optional(),
  ofw_lname: z.string(),
  ofw_fname: z.string().nullable().optional(),
  ofw_mname: z.string().nullable().optional(),
  client_email: z.string(),
  client_contact: z.string().nullable().optional(),
  client_data: z.record(z.unknown()).nullable().optional(),
  p_name: z.string().nullable().optional(),
  ofw_visa: z.string().nullable().optional(),
  ofw_position: z.string().nullable().optional(),
  ofw_trans: z.string().nullable().optional(),
  ofw_gender: z.string().nullable().optional(),
  confirmed_at: z.string().nullable().optional(),
  confirmed_by: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  cancel_reason: z.string().nullable().optional(),
  staff_notes: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AppointmentRow = z.infer<typeof AppointmentRowSchema>;

/** Supabase services table row (joined) */
export const ServiceRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});
export type ServiceRow = z.infer<typeof ServiceRowSchema>;

/** Appointment with joined service */
export const AppointmentWithServiceSchema = AppointmentRowSchema.extend({
  services: ServiceRowSchema.nullable().optional(),
});
export type AppointmentWithService = z.infer<typeof AppointmentWithServiceSchema>;
