import { z } from 'zod';

/** Supabase fra_registrations row — only columns needed for kiosk check-in */
export const FraRegistrationRowSchema = z.object({
  id: z.string().uuid(),
  transaction_ref: z.string(),
  appointment_date: z.string(),
  pra: z.string().nullable().optional(),
  fra: z.string(),
  agency_email: z.string().nullable().optional(),
  agency_personnel: z.string().nullable().optional(),
  status: z.string(),
  arrived_at: z.string().nullable().optional(),
  staff_notes: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FraRegistrationRow = z.infer<typeof FraRegistrationRowSchema>;
