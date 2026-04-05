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

/** Service type → Supabase service_id mapping */
export const SERVICE_ID_MAP: Readonly<Record<string, string>> = {
  SKILLED_CV: '30c55940-083c-434a-8212-e810f2fa37b2',
  MDW_CV: 'cc50f069-1dc6-48ac-9e04-dbaf2a28b839',
  OWWA: OWWA_SERVICE_ID,
  DH: 'ff4eeaf1-0009-4664-b9d8-6ea48de0f745',
  FRA_REGISTRATION: FRA_SERVICE_ID,
} as const;

/** Service slug (from services table) → queue series + service type */
export const SLUG_MAP: Readonly<Record<string, { series: string; serviceType: string }>> = {
  'skilled-cv':       { series: 'REGULAR',  serviceType: 'SKILLED_CV' },
  'mdw-cv':           { series: 'REGULAR',  serviceType: 'MDW_CV' },
  'dh':               { series: 'REGULAR',  serviceType: 'DH' },
  'owwa':             { series: 'OWWA',     serviceType: 'OWWA' },
  'fra-registration': { series: 'FRA',      serviceType: 'FRA_REGISTRATION' },
  'accreditation':    { series: 'REGULAR',  serviceType: 'ACCREDITATION' },
} as const;

/** Resolve queue series from service_id (fallback when slug lookup fails) */
export function resolveQueueSeries(serviceId: string): { series: string; serviceType: string } {
  if (serviceId === FRA_SERVICE_ID) return { series: 'FRA', serviceType: 'FRA_REGISTRATION' };
  if (serviceId === OWWA_SERVICE_ID) return { series: 'OWWA', serviceType: 'OWWA' };
  for (const [key, id] of Object.entries(SERVICE_ID_MAP)) {
    if (id === serviceId) return { series: 'REGULAR', serviceType: key };
  }
  return { series: 'REGULAR', serviceType: 'SKILLED_CV' };
}

/**
 * Queue series start numbers.
 * - REGULAR: 6001, 6002...
 * - OWWA: 9001, 9002... (same series for appointments + walk-ins)
 * - FRA: 1, 2, 3... (displayed as A001, A002...)
 * - WALKIN_REGULAR: 601, 602... (displayed as W601, W602...)
 * - WALKIN_OWWA: 901, 902... (displayed as W901, W902...)
 */
export function getStartNumber(series: string): number {
  switch (series) {
    case 'REGULAR': return 6001;
    case 'OWWA': return 9001;
    case 'FRA': return 1;
    case 'WALKIN_REGULAR': return 601;
    case 'WALKIN_OWWA': return 901;
    default: return 1;
  }
}

/**
 * Format queue number for display on ticket.
 * - REGULAR: "6001", "6002"
 * - OWWA: "9001", "9002"
 * - FRA: "A001", "A002"
 * - WALKIN_REGULAR: "W601", "W602"
 * - WALKIN_OWWA: "W901", "W902"
 */
export function formatQueueDisplay(queueNumber: number, series: string): string {
  switch (series) {
    case 'FRA':
      return `A${String(queueNumber).padStart(3, '0')}`;
    case 'WALKIN_REGULAR':
    case 'WALKIN_OWWA':
      return `W${queueNumber}`;
    default:
      return String(queueNumber);
  }
}

/** Check if a date is in the future compared to today SGT */
export function isFutureDate(dateStr: string): boolean {
  return dateStr > todaySGT();
}

/** Check if a date is within N days ahead of today SGT */
export function isWithinDaysAhead(dateStr: string, days: number): boolean {
  const today = todaySGT();
  const sgtNow = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  sgtNow.setUTCDate(sgtNow.getUTCDate() + days);
  const cutoff = sgtNow.toISOString().slice(0, 10);
  return dateStr >= today && dateStr <= cutoff;
}

/** Resolve human-readable service label from service_id */
export function resolveServiceLabel(serviceId: string): string {
  for (const [key, id] of Object.entries(SERVICE_ID_MAP)) {
    if (id === serviceId) return SERVICE_LABELS[key] ?? key.replace(/_/g, ' ');
  }
  return 'Contract Verification';
}

/** OFW Transaction type options for walk-in registration */
export const OFW_TRANS_OPTIONS = [
  'Change in Employer',
  'Change in Position',
  'Change in Jobsite',
  'New Record',
] as const;

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

/** UUID regex (used internally by detectScanType) */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Detect whether a scanned QR value is an appointment ref or FRA transaction_ref.
 *
 * FRA refs come in two formats from AgencyHire:
 *   - UUID with hyphens (36 chars): 550e8400-e29b-41d4-a716-446655440000
 *   - Long alphanumeric (20-30 chars): ABCD1234EFGH5678JKLM9012
 *
 * Appointment refs are always 6-10 char uppercase alphanumeric: ABC12345
 */
export function detectScanType(value: string): 'APPOINTMENT' | 'FRA' | 'UNKNOWN' {
  const trimmed = value.trim();
  // FRA: UUID format (36 chars with hyphens)
  if (UUID_REGEX.test(trimmed)) return 'FRA';
  // Appointment: 6-10 char alphanumeric uppercase
  if (/^[A-Z0-9]{6,10}$/.test(trimmed)) return 'APPOINTMENT';
  // FRA: 20-30 char alphanumeric (non-UUID format from AgencyHire)
  if (/^[A-Za-z0-9]{20,30}$/.test(trimmed)) return 'FRA';
  return 'UNKNOWN';
}

/** Format today's date as YYYY-MM-DD in SGT (UTC+8) */
export function todaySGT(): string {
  const now = new Date();
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}
