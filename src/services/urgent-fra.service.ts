/**
 * Urgent FRA Service — receptionist-initiated FRA invitation flow.
 *
 * Receptionist collects: PRA, FRA, # of contracts.
 * Service inserts an `urgent_fra_invitations` row with placeholder workers,
 * generates an invitation token, and returns the URL the client uses to
 * complete the registration on their phone.
 *
 * AgencyHire processes the completion at: {INVITATION_BASE_URL}/{token}
 */

import { getSupabaseWriter } from './supabase.client';
import { todaySGT } from '../lib/constants';

export const INVITATION_BASE_URL = 'https://go.mwosingapore.online/fra-registration/invite';

export interface UrgentFraWorker {
  readonly last_name: string;
  readonly first_name: string;
  readonly middle_name?: string;
}

export interface UrgentFraInput {
  readonly pra: string;
  readonly fra: string;
  readonly workers: ReadonlyArray<UrgentFraWorker>;
}

export interface UrgentFraResult {
  readonly token: string;
  readonly url: string;
  readonly expiresAt: string;
}

/** Generate a 64-char hex token using browser crypto */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create an urgent FRA invitation. Returns the token + completion URL.
 */
export async function createUrgentFraInvitation(
  input: UrgentFraInput,
): Promise<UrgentFraResult> {
  if (!input.pra.trim()) throw new Error('PRA is required');
  if (!input.fra.trim()) throw new Error('FRA is required');
  if (input.workers.length < 1 || input.workers.length > 15) {
    throw new Error('Number of workers must be between 1 and 15');
  }
  for (const w of input.workers) {
    if (!w.first_name.trim()) throw new Error('All workers must have a first name');
    if (!w.last_name.trim()) throw new Error('All workers must have a last name');
  }

  const cleanWorkers = input.workers.map((w) => ({
    last_name: w.last_name.trim(),
    first_name: w.first_name.trim(),
    middle_name: (w.middle_name ?? '').trim(),
  }));

  const supabase = getSupabaseWriter();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('urgent_fra_invitations')
    .insert({
      invitation_token: token,
      agency_email: 'kiosk-walkin@mwosingapore.online',
      pra: input.pra.trim(),
      fra: input.fra.trim(),
      appointment_date: todaySGT(),
      workers: cleanWorkers,
      admin_note: `Created via kiosk (Urgent FRA walk-in). ${cleanWorkers.length} contract(s).`,
      invited_by: 'KIOSK_RECEPTIONIST',
      status: 'pending',
      expires_at: expiresAt,
    });

  if (error) throw new Error(`Urgent FRA creation failed: ${error.message}`);

  return {
    token,
    url: `${INVITATION_BASE_URL}/${token}`,
    expiresAt,
  };
}
