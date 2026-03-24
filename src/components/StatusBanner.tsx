import { useState, useEffect } from 'react';
import { checkSupabaseConnection } from '../services/supabase.client';
import * as nexusApi from '../services/nexus-api.client';

/**
 * Connection status indicators for Supabase and Nexus API.
 * Polls every 30 seconds.
 */
export function StatusBanner() {
  const [supabaseOk, setSupabaseOk] = useState(false);
  const [nexusOk, setNexusOk] = useState(false);

  useEffect(() => {
    async function check() {
      const [s, n] = await Promise.all([
        checkSupabaseConnection(),
        nexusApi.checkConnection(),
      ]);
      setSupabaseOk(s);
      setNexusOk(n);
    }

    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const authenticated = nexusApi.isAuthenticated();

  return (
    <div className="flex items-center gap-4 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${supabaseOk ? 'bg-green-500' : 'bg-red-500'}`} />
        Supabase
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${nexusOk ? 'bg-green-500' : 'bg-red-500'}`} />
        Nexus API
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${authenticated ? 'bg-green-500' : 'bg-orange-400'}`} />
        Auth
      </span>
    </div>
  );
}
