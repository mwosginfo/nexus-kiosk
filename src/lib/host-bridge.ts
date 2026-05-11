/**
 * Tauri-backed implementation of the host API previously provided by Electron's
 * preload bridge. Mounted on `window.electronAPI` for compatibility with existing
 * components; later phases will rename usages to `host`.
 */
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const SETTINGS_FILE = 'nexus-kiosk-settings.json';

const SETTINGS_DEFAULTS: KioskSettings = {
  mode: null,
  rememberMode: false,
  supabaseUrl: '',
  supabaseAnonKey: '',
  supabaseServiceKey: '',
  printerName: '',
  paperWidth: '80mm',
  autoPrint: true,
};

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(SETTINGS_FILE);
  }
  return storePromise;
}

async function getSettings(): Promise<KioskSettings> {
  const store = await getStore();
  const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    const v = await store.get(key);
    if (v !== null && v !== undefined) out[key] = v;
  }
  return out as unknown as KioskSettings;
}

async function saveSettings(partial: Partial<KioskSettings>): Promise<void> {
  const store = await getStore();
  for (const [key, value] of Object.entries(partial)) {
    await store.set(key, value);
  }
  await store.save();
}

async function resolvePrinterName(): Promise<string> {
  const store = await getStore();
  const v = await store.get<string>('printerName');
  return (v ?? '').trim();
}

async function printTicket(data: TicketData): Promise<void> {
  const printerName = await resolvePrinterName();
  await invoke('print_ticket', { data, printerName });
}

async function printQrTicket(data: QrTicketData): Promise<void> {
  const printerName = await resolvePrinterName();
  await invoke('print_qr_ticket', { data, printerName });
}

async function getPrinters(): Promise<PrinterInfo[]> {
  return invoke<PrinterInfo[]>('get_printers');
}

function switchMode(mode: string): void {
  // Lock follows the mode itself — rememberMode only controls whether
  // the mode-select page reappears on next launch, not the window state.
  void invoke('apply_kiosk_lock', { enabled: mode === 'KIOSK' });
}

function onToggleSettings(callback: () => void): () => void {
  let unlisten: (() => void) | null = null;
  void listen('toggle-settings', () => {
    callback();
  }).then((u) => {
    unlisten = u;
  });
  return () => {
    if (unlisten) unlisten();
  };
}

export const host = {
  getSettings,
  saveSettings,
  printTicket,
  printQrTicket,
  getPrinters,
  switchMode,
  onToggleSettings,
} satisfies ElectronAPI;

export function installHostBridge(): void {
  (window as Window & { electronAPI: ElectronAPI }).electronAPI = host;
}
