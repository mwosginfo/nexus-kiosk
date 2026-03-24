import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let supabaseServiceInstance: SupabaseClient | null = null;

/** Initialize or re-initialize the Supabase client with anon key (reads) */
export function initSupabase(url: string, anonKey: string): SupabaseClient {
  supabaseInstance = createClient(url, anonKey);
  return supabaseInstance;
}

/** Initialize the service-role client for write operations (inserts/updates that bypass RLS) */
export function initSupabaseService(url: string, serviceRoleKey: string): SupabaseClient {
  supabaseServiceInstance = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseServiceInstance;
}

/** Get the anon client (for reads) — throws if not initialized */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    throw new Error('Supabase client not initialized. Configure URL and key in settings.');
  }
  return supabaseInstance;
}

/**
 * Get the service-role client (for writes: inserts, updates).
 * Falls back to anon client if service key not configured.
 */
export function getSupabaseWriter(): SupabaseClient {
  return supabaseServiceInstance ?? getSupabase();
}

/** Check if Supabase is configured and reachable */
export async function checkSupabaseConnection(): Promise<boolean> {
  const client = supabaseServiceInstance ?? supabaseInstance;
  if (!client) return false;
  try {
    const { error } = await client
      .from('appointments')
      .select('id')
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}
