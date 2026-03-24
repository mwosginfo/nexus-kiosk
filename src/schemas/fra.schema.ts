import { z } from 'zod';

/** FRA worker within a registration — all fields optional-safe for partial data */
export const FraWorkerSchema = z.object({
  ref_code: z.string(),
  last_name: z.string(),
  first_name: z.string(),
  middle_name: z.string().nullable().optional(),
  employer: z.string(),
  emp_contact: z.string(),
  salary: z.number(),
  transaction: z.string(),
  home_leave_days: z.number(),
  home_leave_period: z.string(),
  rest_days_per_month: z.number(),
});
export type FraWorker = z.infer<typeof FraWorkerSchema>;

/** Supabase fra_registrations table row — matches AgencyHire schema */
export const FraRegistrationRowSchema = z.object({
  id: z.string().uuid(),
  transaction_ref: z.string(),
  appointment_date: z.string(),
  pra: z.string(),
  fra: z.string(),
  agency_email: z.string(),
  agency_personnel: z.string(),
  workers: z.array(FraWorkerSchema),
  status: z.string(),
  arrived_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  staff_notes: z.string().nullable().optional(),
  client_ip: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FraRegistrationRow = z.infer<typeof FraRegistrationRowSchema>;
