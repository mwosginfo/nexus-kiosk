# ELECTRON_AGENT.md — Nexus Kiosk
> You are a senior desktop application engineer working on the Nexus Kiosk Electron app.
> You build the Electron main process — window management, IPC handlers, system integration, and build configuration.

---

## 0. Your Role

You maintain the Electron main process for Nexus Kiosk. This includes window lifecycle, IPC bridge, thermal printing, settings persistence, global shortcuts, kiosk lock mode, and the NSIS installer build.

**You do NOT build React components or Supabase services.** Those live in the renderer process (see FRONTEND_AGENT.md).

**Output priorities:**
1. Stability (crash-free window lifecycle, graceful error handling)
2. Security (service key isolation, kiosk lock integrity)
3. System integration (printing, settings persistence, HID scanner support)
4. Build quality (clean NSIS installer, correct bundling)

---

## 1. Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 33.3.0 (Chromium + Node.js) |
| Language | TypeScript 5.7 (strict, compiled via `tsconfig.electron.json`) |
| Settings | electron-store 8.2.0 |
| Build | electron-builder 25.1.0 (NSIS target) |
| Bundler | Vite 6 (renderer process only) |

---

## 2. Project Structure — Your Domain

```
electron/
├── main.ts                 # App bootstrap, window creation, global shortcuts
├── preload.ts              # Context bridge — IPC exposure to renderer
├── ipc/
│   ├── print.ipc.ts        # Thermal printer selection + ticket printing
│   └── settings.ipc.ts     # Settings CRUD via electron-store
└── services/
    └── settings-store.ts   # electron-store schema, defaults, typed access

# Build config
electron-builder.yml        # NSIS installer config
tsconfig.electron.json      # Separate TS config for main process
```

---

## 3. Window Management

### Window Creation (`main.ts`)

```typescript
// Standard mode
new BrowserWindow({
  width: 1280,
  height: 800,
  webPreferences: {
    preload: join(__dirname, 'preload.js'),
    contextIsolation: true,    // ALWAYS true
    nodeIntegration: false,     // ALWAYS false
  },
});

// Kiosk mode (when mode === 'KIOSK' && rememberMode === true)
new BrowserWindow({
  fullscreen: true,
  kiosk: true,               // Locks the window
  frame: false,               // No title bar
  autoHideMenuBar: true,
  webPreferences: { /* same as above */ },
});
```

**Key rules:**
- `contextIsolation: true` — **never** disable. This is the security boundary.
- `nodeIntegration: false` — **never** enable. Renderer must not access Node.js APIs directly.
- Kiosk lock activates only when both `mode === 'KIOSK'` AND `rememberMode === true`.

### Mode Switching

When `switchMode(mode)` is called via IPC:
1. Close current window
2. Update electron-store with new mode
3. Create new window with appropriate settings (kiosk lock or standard)

### Global Shortcuts

| Shortcut | Handler |
|----------|---------|
| `Ctrl+Shift+S` | Send `toggle-settings` to renderer via IPC |
| `Ctrl+Shift+Q` | Show confirmation dialog → quit app |

Register in `app.whenReady()`, unregister in `app.on('will-quit')`.

---

## 4. IPC Bridge (Context Bridge)

The preload script exposes `window.electronAPI` via `contextBridge.exposeInMainWorld`.

### Exposed Methods

| Method | Direction | IPC Channel | Purpose |
|--------|-----------|-------------|---------|
| `getSettings()` | Renderer → Main | `get-settings` | Load all persisted settings |
| `saveSettings(partial)` | Renderer → Main | `save-settings` | Merge + persist settings |
| `printTicket(data)` | Renderer → Main | `print-ticket` | Print thermal queue ticket |
| `getPrinters()` | Renderer → Main | `get-printers` | List available system printers |
| `switchMode(mode)` | Renderer → Main | `switch-mode` | Recreate window for new mode |
| `onToggleSettings(cb)` | Main → Renderer | `toggle-settings` | Ctrl+Shift+S notification |

### Type Safety

```typescript
// global.d.ts (renderer process)
interface ElectronAPI {
  getSettings(): Promise<KioskSettings>;
  saveSettings(partial: Partial<KioskSettings>): Promise<void>;
  printTicket(data: PrintTicketData): Promise<void>;
  getPrinters(): Promise<PrinterInfo[]>;
  switchMode(mode: 'RECEPTIONIST' | 'KIOSK'): Promise<void>;
  onToggleSettings(callback: () => void): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

---

## 5. Settings Persistence (electron-store)

### Schema

```typescript
interface KioskSettings {
  mode: 'RECEPTIONIST' | 'KIOSK' | null;  // null = show mode select
  rememberMode: boolean;                    // Auto-load mode on startup
  supabaseUrl: string;                      // Supabase project URL
  supabaseAnonKey: string;                  // Public key for reads
  supabaseServiceKey: string;               // Secret key for writes
  printerName: string;                      // Default printer name
  paperWidth: '58mm' | '80mm';             // Thermal paper width
}
```

### Defaults
- `mode: null` — forces mode selection on first launch
- `rememberMode: false` — asks every time
- Supabase fields: empty string (populated from `.env` on first load, then editable)
- `printerName: ''` — must be selected by user
- `paperWidth: '80mm'` — standard thermal

### Merge Strategy
`saveSettings(partial)` performs a shallow merge — only provided fields are updated.

---

## 6. Thermal Printing

### Print Flow
```
Renderer → IPC 'print-ticket' → main.ts → BrowserWindow.webContents.print()
```

### Ticket Data Shape
```typescript
interface PrintTicketData {
  queueNumber: number;
  displayNumber: string;      // Formatted: "6001", "A003", "W601"
  clientName: string;
  serviceType: string;        // "SKILLED_CV", "MDW_CV", etc.
  queueSeries: string;        // "REGULAR", "FRA", etc.
  timestamp: string;          // SGT formatted date/time
}
```

### Print Implementation
- Create an off-screen BrowserWindow with the ticket HTML
- Set page size based on `paperWidth` setting (58mm or 80mm)
- Use `webContents.print()` with `silent: true` and the selected printer
- Close the off-screen window after printing

### Error Handling
- If printer is not found, silently fail (queue number still shows on screen)
- If print fails, log to console but do not throw to renderer
- **Never lose the queue number because of a print failure**

---

## 7. Build Configuration

### electron-builder.yml
```yaml
appId: com.nexus.kiosk
productName: Nexus Kiosk
directories:
  output: release
win:
  target: nsis
nsis:
  oneClick: false
  perMachine: true
  allowToChangeInstallationDirectory: true
files:
  - dist/**/*
  - dist-electron/**/*
```

### Build Output
```
dist/              # Vite-bundled React app
dist-electron/     # Compiled Electron main process
release/           # NSIS installer (.exe)
```

### Build Commands
```bash
npm run build            # Compile everything
npm run build:electron   # Create NSIS installer
```

---

## 8. Security Rules

### Process Isolation
- `contextIsolation: true` — always. Renderer and main process are separate worlds.
- `nodeIntegration: false` — always. Renderer cannot access `fs`, `child_process`, etc.
- All communication through `contextBridge` + `ipcRenderer`/`ipcMain`.

### Key Storage
- Supabase service role key stored in electron-store (encrypted at rest by OS keychain where available)
- Never log keys to console
- Never include keys in error messages or crash reports
- Keys are passed to renderer via `getSettings()` IPC — renderer creates Supabase client

### Kiosk Lock
- In kiosk mode: `fullscreen: true`, `kiosk: true`, `frame: false`
- DevTools disabled in production builds
- Only Ctrl+Shift+S (settings) and Ctrl+Shift+Q (quit) work
- No address bar, no navigation, no escape from kiosk UI

---

## 9. Development vs Production

| Feature | Development | Production |
|---------|-------------|------------|
| Content source | `http://localhost:5174` | `file://dist/index.html` |
| DevTools | Open automatically | Disabled |
| Kiosk lock | Can be escaped with Cmd+Q | Fully locked |
| Shortcuts | Ctrl+Shift+I opens DevTools | Blocked |
| Reload | Ctrl+R works | Blocked in kiosk mode |

---

## 10. What NOT to Do

- Do not set `contextIsolation: false` — this breaks the security model
- Do not set `nodeIntegration: true` — renderer must not access Node APIs
- Do not expose the full electron-store to the renderer — only expose via typed IPC
- Do not log Supabase keys or settings to console
- Do not block the main process with synchronous operations
- Do not use `shell.openExternal()` in kiosk mode
- Do not allow navigation to external URLs in the main window
- Do not use `remote` module (deprecated) — use IPC
- Do not skip the kiosk lock when `rememberMode` is true and mode is KIOSK
- Do not hardcode printer names — always use system printer list
