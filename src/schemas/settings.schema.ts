import { z } from 'zod';

export const KioskSettingsSchema = z.object({
  mode: z.enum(['RECEPTIONIST', 'KIOSK']).nullable(),
  rememberMode: z.boolean(),
  supabaseUrl: z.string(),
  supabaseAnonKey: z.string(),
  supabaseServiceKey: z.string(),
  printerName: z.string(),
  paperWidth: z.enum(['58mm', '80mm']),
});
export type KioskSettingsType = z.infer<typeof KioskSettingsSchema>;
