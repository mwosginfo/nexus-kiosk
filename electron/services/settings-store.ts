import Store from 'electron-store';

interface StoreSchema {
  mode: 'RECEPTIONIST' | 'KIOSK' | null;
  rememberMode: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  printerName: string;
  paperWidth: '80mm';
  autoPrint: boolean;
}

export const settingsStore = new Store<StoreSchema>({
  name: 'nexus-kiosk-settings',
  defaults: {
    mode: null,
    rememberMode: false,
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceKey: '',
    printerName: '',
    paperWidth: '80mm',
    autoPrint: true,
  },
});
