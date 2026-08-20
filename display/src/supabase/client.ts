import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';

/**
 * The bridge's only inbound dependency.
 *
 * It does NOT connect to Nexus. Nexus writes call state into Supabase
 * (`kiosk_checkins`) as it already does for its own purposes; the bridge reads
 * that, and writes its own health back to Supabase for Nexus to read. Neither
 * side opens a socket to the other.
 */
export function createSupabaseClient(config: Config): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

/** Current operating day in SGT (UTC+8) as YYYY-MM-DD. */
export function sgtToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}
