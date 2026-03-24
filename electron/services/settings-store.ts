import Store from 'electron-store';

interface StoreSchema {
  mode: 'RECEPTIONIST' | 'KIOSK' | null;
  rememberMode: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  nexusApiUrl: string;
  nexusUsername: string;
  nexusPassword: string;
  printerName: string;
  paperWidth: '58mm' | '80mm';
}

export const settingsStore = new Store<StoreSchema>({
  name: 'nexus-kiosk-settings',
  defaults: {
    mode: null,
    rememberMode: false,
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceKey: '',
    nexusApiUrl: '',
    nexusUsername: '',
    nexusPassword: '',
    printerName: '',
    paperWidth: '80mm',
  },
});
