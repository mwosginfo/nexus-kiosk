import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { settingsStore } from './services/settings-store';
import { registerPrintHandlers } from './ipc/print.ipc';
import { registerSettingsHandlers } from './ipc/settings.ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const settings = settingsStore.store;
  const isKiosk = settings.mode === 'KIOSK' && settings.rememberMode;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: isKiosk,
    fullscreen: isKiosk,
    frame: !isKiosk,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev or production URL
  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerGlobalShortcuts(): void {
  // Ctrl+Shift+S to toggle settings overlay
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    mainWindow?.webContents.send('toggle-settings');
  });

  // Ctrl+Shift+Q to quit (even in kiosk mode)
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    const result = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Cancel', 'Quit'],
      defaultId: 0,
      title: 'Quit Nexus Kiosk',
      message: 'Are you sure you want to quit?',
    });
    if (result === 1) {
      app.quit();
    }
  });
}

app.whenReady().then(() => {
  registerSettingsHandlers();
  registerPrintHandlers();
  registerGlobalShortcuts();
  createWindow();

  // Handle mode switch from renderer — recreate window with new kiosk setting
  ipcMain.on('switch-mode', (_event, mode: string) => {
    settingsStore.set('mode', mode);
    if (mainWindow) {
      mainWindow.close();
    }
    createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
