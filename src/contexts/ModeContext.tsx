import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { initSupabase, initSupabaseService } from '../services/supabase.client';

type AppMode = 'RECEPTIONIST' | 'KIOSK' | null;

interface ModeContextValue {
  readonly mode: AppMode;
  readonly settings: KioskSettings | null;
  readonly loading: boolean;
  readonly setMode: (mode: AppMode, remember: boolean) => Promise<void>;
  readonly updateSettings: (partial: Partial<KioskSettings>) => Promise<void>;
  readonly settingsOpen: boolean;
  readonly toggleSettings: () => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { readonly children: ReactNode }) {
  const [settings, setSettings] = useState<KioskSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load settings from electron-store on mount
  useEffect(() => {
    void (async () => {
      try {
        const s = await window.electronAPI.getSettings();

        // Apply .env build-time defaults for fields not yet configured
        const merged: KioskSettings = {
          ...s,
          supabaseUrl: s.supabaseUrl || (import.meta.env['VITE_SUPABASE_URL'] as string | undefined ?? ''),
          supabaseAnonKey: s.supabaseAnonKey || (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined ?? ''),
        };
        setSettings(merged);

        // Initialize Supabase clients if configured
        if (s.supabaseUrl && s.supabaseAnonKey) {
          initSupabase(s.supabaseUrl, s.supabaseAnonKey);
        }
        if (s.supabaseUrl && s.supabaseServiceKey) {
          initSupabaseService(s.supabaseUrl, s.supabaseServiceKey);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Listen for Ctrl+Shift+S from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onToggleSettings(() => {
      setSettingsOpen((prev) => !prev);
    });
    return cleanup;
  }, []);

  const setMode = useCallback(async (mode: AppMode, remember: boolean) => {
    await window.electronAPI.saveSettings({ mode, rememberMode: remember });
    setSettings((prev) => (prev ? { ...prev, mode, rememberMode: remember } : prev));
  }, []);

  const updateSettings = useCallback(async (partial: Partial<KioskSettings>) => {
    await window.electronAPI.saveSettings(partial);
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));

    // Re-initialize Supabase if relevant settings changed
    if (partial.supabaseUrl !== undefined || partial.supabaseAnonKey !== undefined) {
      const url = partial.supabaseUrl ?? settings?.supabaseUrl ?? '';
      const key = partial.supabaseAnonKey ?? settings?.supabaseAnonKey ?? '';
      if (url && key) initSupabase(url, key);
    }
    if (partial.supabaseUrl !== undefined || partial.supabaseServiceKey !== undefined) {
      const url = partial.supabaseUrl ?? settings?.supabaseUrl ?? '';
      const sKey = partial.supabaseServiceKey ?? settings?.supabaseServiceKey ?? '';
      if (url && sKey) initSupabaseService(url, sKey);
    }
  }, [settings]);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => !prev);
  }, []);

  const mode = settings?.rememberMode ? settings.mode : settings?.mode ?? null;

  return (
    <ModeContext.Provider
      value={{ mode, settings, loading, setMode, updateSettings, settingsOpen, toggleSettings }}
    >
      {children}
    </ModeContext.Provider>
  );
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used within ModeProvider');
  return ctx;
}
