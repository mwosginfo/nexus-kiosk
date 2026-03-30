/** Electron preload API exposed via contextBridge */
interface TicketData {
  readonly queueNumber: string;
  readonly clientName: string;
  readonly serviceType: string;
}

interface PrinterInfo {
  readonly name: string;
  readonly isDefault: boolean;
}

interface KioskSettings {
  readonly mode: 'RECEPTIONIST' | 'KIOSK' | null;
  readonly rememberMode: boolean;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceKey: string;
  readonly printerName: string;
  readonly paperWidth: '58mm' | '80mm';
}

interface ElectronAPI {
  getSettings(): Promise<KioskSettings>;
  saveSettings(settings: Partial<KioskSettings>): Promise<void>;
  printTicket(data: TicketData): Promise<void>;
  getPrinters(): Promise<PrinterInfo[]>;
  switchMode(mode: string): void;
  onToggleSettings(callback: () => void): () => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
