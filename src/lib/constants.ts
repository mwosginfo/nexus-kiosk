/** Supabase service_id that maps to OWWA queue series */
export const OWWA_SERVICE_ID = '23470e2d-397e-4a24-b3ee-f55ed3fec65c' as const;

/** Supabase service_id for FRA Registration */
export const FRA_SERVICE_ID = '7b9257b9-b2b6-404c-b277-c585ef27ec34' as const;

/** Service type labels for display */
export const SERVICE_LABELS: Readonly<Record<string, string>> = {
  SKILLED_CV: 'Skilled Worker - CV',
  MDW_CV: 'MDW - Contract Verification',
  DH: 'Direct Hire',
  OWWA: 'OWWA',
  FRA_REGISTRATION: 'FRA Registration',
  ACCREDITATION: 'Accreditation',
} as const;

/** Service type → Supabase service_id mapping for walk-in creation */
export const SERVICE_ID_MAP: Readonly<Record<string, string>> = {
  SKILLED_CV: '30c55940-083c-434a-8212-e810f2fa37b2',
  MDW_CV: 'cc50f069-1dc6-48ac-9e04-dbaf2a28b839',
  OWWA: OWWA_SERVICE_ID,                                   // 23470e2d-397e-4a24-b3ee-f55ed3fec65c
  DH: 'ff4eeaf1-0009-4664-b9d8-6ea48de0f745',
  FRA_REGISTRATION: FRA_SERVICE_ID,                        // 7b9257b9-b2b6-404c-b277-c585ef27ec34
} as const;

/** Look up service ID with runtime guard — throws if not configured */
export function getServiceId(serviceType: string): string {
  const id = SERVICE_ID_MAP[serviceType];
  if (!id) throw new Error(`No service_id configured for type: ${serviceType}`);
  return id;
}

/** Service type → slug mapping for walk-in appointment creation */
export const SERVICE_SLUG_MAP: Readonly<Record<string, string>> = {
  MDW_CV: 'mdw-cv',
  SKILLED_CV: 'skilled-cv',
  OWWA: 'owwa',
  DH: 'dh',
  ACCREDITATION: 'accreditation',
} as const;

/** Ref code charset (matches AgencyHire) */
export const REF_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generate a random ref code (8 chars) */
export function generateRefCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += REF_CODE_CHARSET[Math.floor(Math.random() * REF_CODE_CHARSET.length)];
  }
  return code;
}

/** UUID regex for detecting FRA transaction_ref scans */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Format today's date as YYYY-MM-DD in SGT (UTC+8) */
export function todaySGT(): string {
  const now = new Date();
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}
