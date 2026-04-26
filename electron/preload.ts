import { contextBridge, ipcRenderer } from 'electron';

export interface TicketData {
  readonly queueNumber: string;
  readonly clientName: string;
  readonly serviceType: string;
}

export interface QrTicketData {
  readonly title: string;
  readonly qrDataUrl: string;
  readonly pra: string;
  readonly fra: string;
  readonly contractCount: number;
  readonly instructions: string;
}

export interface PrinterInfo {
  readonly name: string;
  readonly isDefault: boolean;
}

export interface KioskSettings {
  readonly mode: 'RECEPTIONIST' | 'KIOSK' | null;
  readonly rememberMode: boolean;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceKey: string;
  readonly printerName: string;
  readonly paperWidth: '58mm' | '80mm';
}

const electronAPI = {
  // Settings
  getSettings: (): Promise<KioskSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Partial<KioskSettings>): Promise<void> =>
    ipcRenderer.invoke('save-settings', settings),

  // Printing
  printTicket: (data: TicketData): Promise<void> =>
    ipcRenderer.invoke('print-ticket', data),
  printQrTicket: (data: QrTicketData): Promise<void> =>
    ipcRenderer.invoke('print-qr-ticket', data),
  getPrinters: (): Promise<PrinterInfo[]> => ipcRenderer.invoke('get-printers'),

  // Mode switch (triggers window recreation)
  switchMode: (mode: string): void => ipcRenderer.send('switch-mode', mode),

  // Settings toggle listener
  onToggleSettings: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('toggle-settings', handler);
    return () => ipcRenderer.removeListener('toggle-settings', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for renderer
export type ElectronAPI = typeof electronAPI;
