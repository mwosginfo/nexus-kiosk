import { ipcMain } from 'electron';
import { settingsStore } from '../services/settings-store';

export function registerSettingsHandlers(): void {
  ipcMain.handle('get-settings', () => {
    return settingsStore.store;
  });

  ipcMain.handle('save-settings', (_event, partial: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(partial)) {
      settingsStore.set(key as never, value as never);
    }
  });
}
