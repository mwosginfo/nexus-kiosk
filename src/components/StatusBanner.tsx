import { useState, useEffect } from 'react';
import { checkSupabaseConnection } from '../services/supabase.client';

/**
 * Connection status indicator for Supabase.
 * Polls every 30 seconds.
 */
export function StatusBanner() {
  const [supabaseOk, setSupabaseOk] = useState(false);

  useEffect(() => {
    async function check() {
      setSupabaseOk(await checkSupabaseConnection());
    }

    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-4 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${supabaseOk ? 'bg-green-500' : 'bg-red-500'}`} />
        Supabase
      </span>
    </div>
  );
}
