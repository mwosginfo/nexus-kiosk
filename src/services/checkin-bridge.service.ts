/**
 * Supabase Bridge — replaces direct Nexus API calls for check-in.
 *
 * Flow:
 *   1. INSERT into kiosk_checkins (ref_code, appointment_type) → status=PENDING
 *   2. Subscribe to Realtime on that row
 *   3. Wait for Nexus to UPDATE with queue_number + status=PROCESSED
 *   4. Return the result to the caller
 *
 * Timeout after 20s if Nexus doesn't respond.
 */

import { getSupabase, getSupabaseWriter } from './supabase.client';
import { z } from 'zod';

// ─── Response schema ────────────────────────────────────────────────────────

const BridgeResultSchema = z.object({
  queue_number: z.number(),
  display_number: z.string(),
  queue_series: z.string(),
  service_type: z.string().nullable().optional(),
  status: z.enum(['PROCESSED', 'FAILED']),
  error_message: z.string().nullable().optional(),
});

export type BridgeResult = z.infer<typeof BridgeResultSchema>;

export interface CheckinBridgeResponse {
  readonly queueNumber: number;
  readonly displayNumber: string;
  readonly queueSeries: string;
  readonly serviceType: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BRIDGE_TIMEOUT_MS = 20_000;
const TABLE = 'kiosk_checkins' as const;

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Request a queue number via the Supabase bridge.
 *
 * @param refCode - appointment ref_code or FRA transaction_ref
 * @param appointmentType - 'APPOINTMENT' for regular/OWWA, 'FRA' for FRA registrations
 * @returns Queue assignment from Nexus
 * @throws Error on timeout, failure, or connection issues
 */
export async function requestCheckin(
  refCode: string,
  appointmentType: 'APPOINTMENT' | 'FRA',
): Promise<CheckinBridgeResponse> {
  const supabase = getSupabaseWriter();

  // 1. Insert the check-in request
  const { data: inserted, error: insertError } = await supabase
    .from(TABLE)
    .insert({
      ref_code: refCode,
      appointment_type: appointmentType,
      status: 'PENDING',
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `Failed to submit check-in request: ${insertError?.message ?? 'No data returned'}`,
    );
  }

  const rowId = z.string().uuid().parse((inserted as Record<string, unknown>).id);

  // 2. Subscribe to Realtime and wait for the response
  return waitForResult(rowId);
}

// ─── Wait for Nexus to process the row ──────────────────────────────────────

function waitForResult(rowId: string): Promise<CheckinBridgeResponse> {
  const supabase = getSupabase();

  return new Promise<CheckinBridgeResponse>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Channel name unique per request
    const channelName = `kiosk-checkin-${rowId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: TABLE,
          filter: `id=eq.${rowId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          if (settled) return;

          const parsed = BridgeResultSchema.safeParse(payload.new);
          if (!parsed.success) return; // Ignore partial updates

          settled = true;
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          void channel.unsubscribe();

          const result = parsed.data;

          if (result.status === 'FAILED') {
            reject(new Error(result.error_message ?? 'Check-in failed on server'));
            return;
          }

          resolve({
            queueNumber: result.queue_number,
            displayNumber: result.display_number,
            queueSeries: result.queue_series,
            serviceType: result.service_type ?? '',
          });
        },
      )
      .subscribe();

    // 3. Timeout fallback — also poll once in case the Realtime event was missed
    timeoutId = setTimeout(() => {
      if (settled) return;

      // One last poll before giving up
      void pollForResult(rowId)
        .then((pollResult) => {
          if (settled) return;
          settled = true;
          void channel.unsubscribe();

          if (pollResult) {
            resolve(pollResult);
          } else {
            reject(new Error('Check-in timed out. Nexus may be unavailable — please see staff.'));
          }
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          void channel.unsubscribe();
          reject(new Error('Check-in timed out. Nexus may be unavailable — please see staff.'));
        });
    }, BRIDGE_TIMEOUT_MS);
  });
}

// ─── Fallback poll ──────────────────────────────────────────────────────────

async function pollForResult(rowId: string): Promise<CheckinBridgeResponse | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(TABLE)
    .select('queue_number, display_number, queue_series, service_type, status, error_message')
    .eq('id', rowId)
    .single();

  if (error || !data) return null;

  const parsed = BridgeResultSchema.safeParse(data);
  if (!parsed.success) return null;

  if (parsed.data.status === 'FAILED') {
    throw new Error(parsed.data.error_message ?? 'Check-in failed on server');
  }

  if (parsed.data.status !== 'PROCESSED') return null;

  return {
    queueNumber: parsed.data.queue_number,
    displayNumber: parsed.data.display_number,
    queueSeries: parsed.data.queue_series,
    serviceType: parsed.data.service_type ?? '',
  };
}
