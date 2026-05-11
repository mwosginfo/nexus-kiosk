# CLAUDE.md — Nexus Kiosk
> Authoritative context document for AI coding assistants working on this codebase.
> Read this fully before generating any code, component, or configuration change.

---

## 0. AI Assistant Workflow Rules

These rules apply to every task in this project, without exception.

### Before Writing Code
1. **Always PLAN first.** State the approach, identify affected files, and flag ambiguities before generating code.
2. **Check this CLAUDE.md** for relevant constraints before implementing anything.
3. This is a **standalone Tauri 2 app** (Rust host + React renderer). The legacy Electron host is preserved as a fallback under `electron/` but is no longer the primary build path. There is no NestJS backend, no Prisma ORM, no local PostgreSQL database. All data flows through Supabase.

### After Writing Code
4. **Re-check this CLAUDE.md** against what was just written. If the code drifts from these rules, correct immediately.
5. If a fix is mediocre, scrap it and implement the elegant solution.
6. **Update documentation.** After every feature or module change, update the relevant sections in `CLAUDE.md`, `WORKFLOWS.md`, and `AUDIT.md`.

### TypeScript Directives
1. **Zero `any`:** Never use `any`. Use `unknown` and narrow with Zod or type guards.
2. **Exhaustive checks:** Always add `default: return assertNever(x)` on union/status switches.
   ```typescript
   function assertNever(x: never): never {
     throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
   }
   ```
3. **Immutability:** Prefer `readonly` arrays and properties in domain models.
4. **Parse, don't validate:** Every Supabase response must be typed as `unknown` and parsed through a Zod schema before entering domain logic.

---

## 1. What This Project Is

**Nexus Kiosk** is a standalone Windows desktop application for front-desk check-in operations. It is part of the Project Nexus ecosystem but runs independently — on a **different network** from the Nexus backend (LAN).

It has two operating modes:
- **Receptionist Mode** — Staff-operated. QR scanning, manual search, walk-in registration, appointment browsing.
- **Kiosk Mode** — Unattended self-service. Client scans QR or keys in a reference code, gets a queue number, ticket prints automatically.

### What This App Does
- Looks up appointments / FRA registrations / accreditation submissions from Supabase
- Checks in clients by writing to Supabase `kiosk_checkins`
- Generates queue numbers via Supabase RPC (`next_queue_number`)
- Prints thermal queue tickets (ESC/POS, 80mm)
- Manages FRA (agency) group check-ins
- Handles pickup tickets for DH, FRA, and Accreditation
- Registers walk-in clients (receptionist mode only)

### What This App Does NOT Do
- Call clients to counters (Nexus backend does this)
- Process transactions or issue OR numbers
- Manage the queue display TV
- Connect to the Nexus backend API or local PostgreSQL
- Store any persistent client data locally

---

## 2. Infrastructure

| Layer | Technology | Version |
|---|---|---|
| Desktop Framework (primary) | Tauri | 2.x |
| Rust toolchain | rustc / cargo | 1.77+ |
| Desktop Framework (fallback) | Electron | 33.3.0 |
| Frontend | React | 19.0.0 |
| Bundler | Vite | 6.0.0 |
| Styling | Tailwind CSS | 3.4.17 |
| Database Access | Supabase JS | 2.49.0 |
| Runtime Schema | Zod | 3.24.0 |
| TypeScript | TypeScript | 5.7.0 (strict mode) |
| State Management | React Context | Built-in |
| Settings Store | tauri-plugin-store (Tauri) / electron-store (fallback) | 2.x / 8.2.0 |
| Thermal Print | escpos hand-crafted bytes via `printers` crate (Tauri) | — |
| Icons | FontAwesome (receptionist only) | 7.2.0 |
| Build | Tauri NSIS bundler / electron-builder fallback | — / 25.1.0 |

### Project Structure
```
nexus-kiosk/
├── .claude/                    # AI documentation & agent definitions
│   ├── CLAUDE.md               # This file — master constraints
│   ├── WORKFLOWS.md            # User-facing check-in workflows
│   ├── DATABASE.md             # Supabase tables reference
│   ├── AUDIT.md                # Audit checklist for correctness
│   └── agents/                 # Specialized agent role files
├── src-tauri/                  # Tauri 2 host (Rust)
│   ├── Cargo.toml              # Crate manifest
│   ├── tauri.conf.json         # Window config, bundler, dev URL
│   ├── build.rs                # Tauri build script
│   ├── capabilities/           # Per-window permission grants
│   │   └── default.json
│   ├── icons/                  # Generated icon set
│   └── src/
│       ├── main.rs             # Binary entry → calls lib::run()
│       ├── lib.rs              # Plugin setup, command registry, shortcut handler
│       ├── print.rs            # ESC/POS commands (printTicket, printQrTicket, getPrinters)
│       └── window_ctl.rs       # apply_kiosk_lock, confirm_and_quit
├── electron/                   # FALLBACK host (Node.js/Electron) — kept for emergency
│   ├── main.ts                 # Window creation, shortcuts, kiosk lock
│   ├── preload.ts              # Context bridge (IPC exposure)
│   ├── ipc/
│   │   ├── print.ipc.ts        # HTML→print thermal handler
│   │   └── settings.ipc.ts     # Settings persistence
│   └── services/
│       └── settings-store.ts   # electron-store schema & defaults
├── src/                        # React renderer (shared by both hosts)
│   ├── main.tsx                # React entry — installs host-bridge before mount
│   ├── App.tsx                 # Root component (mode switching)
│   ├── index.css               # Tailwind theme (light/dark)
│   ├── global.d.ts             # Host API type declarations
│   ├── components/             # Shared UI components
│   │   ├── ScannerInput.tsx    # HID barcode scanner input
│   │   ├── QueueNumberDisplay.tsx
│   │   ├── AppointmentCard.tsx
│   │   ├── FraCard.tsx
│   │   ├── StatusBanner.tsx    # Supabase connection indicator
│   │   ├── DatePicker.tsx
│   │   └── OnScreenKeyboard.tsx
│   ├── contexts/
│   │   └── ModeContext.tsx     # Global mode + settings state
│   ├── hooks/
│   │   ├── useIdleTimer.ts     # Auto-reset on inactivity
│   │   └── useScanner.ts       # Barcode scanner keyboard capture
│   ├── pages/
│   │   ├── ModeSelectPage.tsx
│   │   ├── SettingsPage.tsx    # Supabase + printer configuration
│   │   ├── kiosk/              # Self-service screens (no icons)
│   │   │   ├── KioskLayout.tsx # State machine controller
│   │   │   ├── SplashScreen.tsx
│   │   │   ├── TypeSelectScreen.tsx   # OFW/Employer | FRA/EA tiles
│   │   │   ├── EntryScreen.tsx        # Scan + manual ref-code entry
│   │   │   ├── SuccessScreen.tsx
│   │   │   └── ErrorScreen.tsx
│   │   └── receptionist/       # Staff-operated screens
│   │       ├── ReceptionistLayout.tsx
│   │       ├── SearchPanel.tsx
│   │       ├── CheckinPanel.tsx
│   │       └── WalkInModal.tsx
│   ├── schemas/                # Zod validation schemas
│   │   ├── appointment.schema.ts
│   │   ├── fra.schema.ts
│   │   ├── submission.schema.ts       # Accreditation pickup
│   │   └── settings.schema.ts
│   ├── services/               # Supabase API layer
│   │   ├── supabase.client.ts
│   │   ├── appointment.service.ts
│   │   ├── fra.service.ts
│   │   ├── submission.service.ts      # Accreditation lookup
│   │   ├── pickup.service.ts          # DH/FRA/Accreditation pickup resolver
│   │   └── queue.service.ts
│   └── lib/
│       ├── constants.ts        # Service IDs, queue series, formatting, todaySGT/daysAgoSGT
│       ├── business-hours.ts   # FRA 12pm SGT cutoff
│       └── host-bridge.ts      # Tauri-backed window.electronAPI implementation
├── supabase/                   # Supabase configuration
├── index.html
├── package.json
├── tsconfig.json               # Strict TypeScript config
├── tsconfig.electron.json      # Electron-specific TS config (fallback)
├── vite.config.ts              # Vite bundler (port 5174, Tauri-aware)
├── tailwind.config.ts
├── electron-builder.yml        # NSIS installer config (fallback)
└── postcss.config.js
```

### Build & Run

**Tauri (primary):**
```bash
npm run dev               # Vite dev server alone (browser-only debugging)
npm run tauri:dev         # Vite + Tauri host (development)
npm run build:web         # Compile TS + bundle React (no host)
npm run tauri:build       # Build Windows NSIS installer via Tauri → src-tauri/target/release/bundle/
```

**Electron (fallback only — do not use unless Tauri is broken):**
```bash
npm run dev:electron
npm run build:electron
```

---

## 3. Architecture — Two-Process Model

The Tauri host (Rust) and the React renderer communicate over the Tauri IPC channel via `@tauri-apps/api invoke` and Tauri events. The renderer never sees the host code directly.

```
┌─── Host Process (Rust, Tauri) ──────────────────────┐
│  src-tauri/src/lib.rs                                │
│  - WebView2 window management, kiosk lock, shortcuts │
│  - tauri-plugin-store (settings persistence)         │
│  - ESC/POS thermal print via `printers` crate        │
│  - Service role key never leaves the renderer (it    │
│    is held in the settings store, accessed by JS)    │
└──────────┬───────────────────────────────────────────┘
           │  Tauri invoke + events
┌──────────┴───────────────────────────────────────────┐
│  Renderer Process (React)                            │
│  src/App.tsx                                         │
│  - All UI rendering                                  │
│  - Supabase reads (anon key)                         │
│  - Supabase writes (service key via getSupabaseWriter)│
│  - Mode state machine                                │
│  - Scanner input handling                            │
│  - host-bridge.ts shim mounts on window.electronAPI  │
│    so existing code keeps working unchanged          │
└──────────────────────────────────────────────────────┘
```

### Host Bridge (`window.electronAPI`)

The `electronAPI` name is preserved on `window` as a migration shim. Under Tauri it is implemented by `src/lib/host-bridge.ts`, which uses `@tauri-apps/plugin-store` for settings, `invoke()` for printing/window control, and `listen()` for shortcut events.

| Method | Backed by | Purpose |
|--------|-----------|---------|
| `getSettings()` | `Store.load('nexus-kiosk-settings.json')` | Load persisted settings |
| `saveSettings(partial)` | Store + `save()` | Persist setting changes |
| `printTicket(data)` | Rust `print_ticket` command | ESC/POS thermal queue ticket |
| `printQrTicket(data)` | Rust `print_qr_ticket` command | ESC/POS native QR ticket |
| `getPrinters()` | Rust `get_printers` command | List Windows printers |
| `switchMode(mode)` | Rust `apply_kiosk_lock` command | Toggle fullscreen / decorations in place |
| `onToggleSettings(cb)` | Tauri event `toggle-settings` | Ctrl+Shift+S handler |

### Global Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Toggle settings overlay (emits `toggle-settings` event) |
| `Ctrl+Shift+Q` | Quit application (with native confirm dialog) |

Registered via `tauri-plugin-global-shortcut` in `src-tauri/src/lib.rs`.

---

## 4. Supabase Integration — The Only Data Source

This app has **no local database**. All data comes from and goes to Supabase.

### Two Supabase Clients
| Client | Key | Purpose |
|--------|-----|---------|
| `getSupabase()` | Anon key | Read: appointments, fra_registrations, services |
| `getSupabaseWriter()` | Service role key | Write: kiosk_checkins INSERT, fra_registrations UPDATE, submissions read for pickup |

Both clients are initialized lazily in `src/services/supabase.client.ts`.

### Supabase Tables — Access Matrix

| Table | Read | Write | Key Columns |
|-------|------|-------|-------------|
| `appointments` | YES | Limited (`appt_status`, `staff_notes`) | `ref_code`, `service_id`, `ofw_fname/lname/mname`, `client_email`, `client_contact`, `status`, `appt_status`, `appointment_date` |
| `fra_registrations` | YES | Limited (`status`, `arrived_at`, `staff_notes`) | `transaction_ref`, `pra`, `fra`, `status`, `appointment_date`, `arrived_at` |
| `submissions` | YES (pickup only) | NO | `ref_code`, `pra_name`, `p_name`, `trans_status` |
| `services` | YES | NO | `id`, `slug` — maps service_id to queue series |
| `kiosk_checkins` | Duplicate check | YES (INSERT) | See AUDIT.md Section 4 for full column spec |

### Queue Number Generation — CRITICAL

**Always use the Supabase RPC. Never generate queue numbers locally.**

```typescript
const { data } = await supabase.rpc('next_queue_number', {
  p_queue_date: todaySGT(),       // "2026-05-04"
  p_queue_series: 'REGULAR',      // or 'FRA', 'OWWA', 'WALKIN_*'
  p_start_number: 6000,           // Series-specific start number
});
```

The RPC uses `pg_advisory_xact_lock` to prevent race conditions across multiple kiosk instances.

### Queue Series Configuration

| Series | Start | Display | Example |
|--------|-------|---------|---------|
| `REGULAR` | 6000 | Plain number | `6001`, `6002` |
| `OWWA` | 9000 | Plain number | `9001`, `9002` |
| `FRA` | 0 | `A` + 3-digit pad | `A001`, `A002` |
| `WALKIN_REGULAR` | 600 | `W` + number | `W601`, `W602` |
| `WALKIN_OWWA` | 900 | `W` + number | `W901`, `W902` |
| `WALKIN_FRA` | 0 | `WA` + 2-digit pad | `WA01`, `WA02` |

**Pickups always use `REGULAR` (6000 series)**, regardless of underlying service. The `kiosk_checkins.remarks` column is set to `'PICKUP'` to distinguish them at the receptionist console.

### Service ID → Queue Mapping

| Service Slug | Service Type | Queue Series |
|---|---|---|
| `skilled-cv` | `SKILLED_CV` | `REGULAR` |
| `mdw-cv` | `MDW_CV` | `REGULAR` |
| `dh` | `DH` | `REGULAR` |
| `owwa` | `OWWA` | `OWWA` |
| `fra-registration` | `FRA_REGISTRATION` | `FRA` |
| `accreditation` | `ACCREDITATION` | `REGULAR` |

### Known Service UUIDs
```
SKILLED_CV  = 30c55940-083c-434a-8212-e810f2fa37b2
MDW_CV      = cc50f069-1dc6-48ac-9e04-dbaf2a28b839
DH          = ff4eeaf1-0009-4664-b9d8-6ea48de0f745
OWWA        = 23470e2d-397e-4a24-b3ee-f55ed3fec65c
FRA         = 7b9257b9-b2b6-404c-b277-c585ef27ec34
```

---

## 5. Domain Logic Rules

### 5.1 Timezone — SGT (UTC+8) — CRITICAL

**All dates must be Singapore Time. Never use UTC.**

```typescript
// ✅ Correct — use the helper from lib/constants.ts
import { todaySGT, daysAgoSGT } from './lib/constants';
const today = todaySGT();
const cutoff = daysAgoSGT(14);

// ❌ WRONG — gives yesterday between midnight and 8am SGT
new Date().toISOString().split('T')[0]
```

The Rust side uses `chrono::FixedOffset::east_opt(8 * 3600)` for the same purpose when stamping print tickets.

### 5.2 Ref Code Format Detection

```typescript
function detectScanType(value: string): 'APPOINTMENT' | 'FRA' | 'UNKNOWN' {
  if (UUID_REGEX.test(value)) return 'FRA';
  if (/^[A-Z0-9]{6,10}$/.test(value)) return 'APPOINTMENT';
  if (/^[A-Za-z0-9]{20,30}$/.test(value)) return 'FRA';
  return 'UNKNOWN';
}
```

Accreditation reference codes (e.g. `HSW2601-FM00CD`) are looked up only when the OFW/Employer path fails to find an `appointments` row — they are not detected by `detectScanType`.

### 5.3 Client Name Display

Appointment data stores names in `ofw_fname`, `ofw_mname`, `ofw_lname`.

```typescript
// ✅ Always use this pattern
const fullName = [ofw_fname, ofw_mname, ofw_lname].filter(Boolean).join(' ');
```

For accreditation pickup tickets the name comes from `submissions.pra_name` (preferred) or `submissions.p_name` (fallback). For FRA tickets it is `fra_registrations.fra` (the agency name).

### 5.4 Appointment Field Access

OFW fields are **dedicated top-level columns** on `appointments`:
- `ofw_fname`, `ofw_lname`, `ofw_mname`
- `ofw_gender`, `ofw_visa`, `ofw_position`, `ofw_trans`
- `client_contact`, `p_name`

**Do NOT read these from `client_data` JSONB.** The JSONB is legacy; top-level columns are authoritative.

### 5.5 Same-Day vs Deferred Re-check-in

`validateAppointment()` in `appointment.service.ts` enforces the Nexus backend filter (queue.service.ts:871-873):

| Path | Condition | Rule |
|---|---|---|
| Hard block | `appointments.status ∈ {cancelled, completed, no_show}` | Reject. |
| Deferred re-check-in | `appointments.appt_status === 'DEFERRED'` AND `appointment_date >= todaySGT() − 14d` | Allow regardless of `appointment_date`. Calls `markArrivedFromDeferred` which clears `staff_notes`. |
| Same-day | otherwise | Allow only when `appointment_date === todaySGT()`. |

### 5.6 FRA Check-in Window

FRA registrations may be checked in from today through 14 days back (CLAUDE.md historical rule). The `lookupByRef` helper in `fra.service.ts` enforces the window via `daysAgoSGT(14)`. Statuses `completed` and `cancelled` are blocked for fresh check-in (`completed` triggers the pickup branch instead).

### 5.7 FRA 12pm SGT Cutoff

FRA / Employment Agency check-in is open from 09:00 SGT and closes at 12:00 SGT. After noon the kiosk still renders the FRA tile, but selecting it (or scanning an FRA UUID) shows the cutoff message verbatim and refuses the check-in:

```
Cut off of submission for Contract at 12PM. You may resubmit
the next working day, between 9AM and 12PM.
```

Implemented in `src/lib/business-hours.ts` (`isFraCheckinOpen()` + `FRA_CUTOFF_MESSAGE`). Enforced in both the kiosk type-select tile and the `doCheckin` entry guard so the rule cannot be bypassed by an HID scanner.

### 5.8 Pickup Eligibility

A scanned/keyed reference is treated as a **pickup** (issuing a `PICKUP` ticket on the regular 6000 series) when one of the following is true. Resolution lives in `src/services/pickup.service.ts`.

| Kind | Source table | Pickup signal | Notes |
|---|---|---|---|
| **DH** | `appointments` | `service_id == DH` AND `appointment_date < todaySGT()` AND `appt_status === 'ARRIVED'` | Mirrors receptionist `CheckinPanel.tsx:125-141`. |
| **Accreditation** | `submissions` | `trans_status === 'For Submission'` | Submissions never enter the kiosk queue otherwise. Resolved only when no `appointments` row matches the ref. |
| **FRA** | `fra_registrations` | `status === 'completed'` | The Nexus backend sets `completed` post-OR. Group-mixed cases stay in receptionist territory. |

All pickups insert with `queueSeries: 'REGULAR'`, `priority: 3`, `remarks: 'PICKUP'`. The printed `serviceType` line reads `PICKUP - DH`, `PICKUP - FRA`, or `PICKUP - ACCREDITATION` — generated by `pickupService.pickupTicketLabel()`.

### 5.9 Duplicate Prevention

Before every check-in, query `kiosk_checkins` for today's date + ref_code. If a match exists (status not in `{FAILED, DEFERRED}`), show the existing queue number instead of creating a duplicate. Pickup writes go through the same dedup check.

### 5.10 Priority System

| Check-in Type | Priority | Effect |
|---|---|---|
| Appointment / FRA / Pickup | 3 | Called first by Nexus backend |
| Walk-in (regular) | 2 | Receptionist mode only — counter staff dispatch |
| Walk-in OWWA | 3 | Same priority as appointments |

Lower number = higher priority.

---

## 6. Security Rules

### Keys & Secrets
- **Anon key** — used for reads (appointments, services). Safe to be in renderer process via env vars.
- **Service role key** — used for writes (kiosk_checkins INSERT, fra_registrations UPDATE). Stored in `tauri-plugin-store` (file: `nexus-kiosk-settings.json`), accessed via `getSupabaseWriter()`.
- Service role key must **never** be hardcoded in source code.
- All keys come from `.env` (build-time defaults) or runtime settings.

### Kiosk Mode Lock
When `mode === 'KIOSK'` and `rememberMode === true`:
- Window is fullscreen (`apply_kiosk_lock` Rust command sets `set_fullscreen(true)`, `set_decorations(false)`, `set_resizable(false)`)
- No menu bar, no address bar, no dev tools
- Cannot navigate away from kiosk UI
- Only `Ctrl+Shift+S` (settings) and `Ctrl+Shift+Q` (quit) work

Mode switches apply **in place** under Tauri (no window recreate). The Electron fallback recreates the window.

### Data Handling
- This app does **not** store PII locally beyond the current session
- Settings store persists only: mode, Supabase credentials, printer settings
- No client data is cached between sessions
- Thermal ticket prints contain: queue number, service type (or `PICKUP - X`), client name, date/time

---

## 7. Frontend Rules

- **React 19 + Tailwind CSS 3.4**, bundled with **Vite 6**
- UI philosophy: **Speed and clarity for 1-second interactions.** Every check-in should complete in under 3 seconds.
- Dark mode via CSS `.dark` class on `<html>`, managed by `ModeContext`
- Do not add animation libraries or heavy dependencies — this runs on office hardware
- Large, high-contrast text for kiosk mode (readable from 2 meters)
- Touch-friendly targets (min 48px) for kiosk/tablet use

### Kiosk-Mode UI Rules
- **No icons.** Kiosk screens (`src/pages/kiosk/`) must not import FontAwesome. Use text labels, dividers, and uppercase letter-spaced section headers instead. The legacy receptionist screens may still use FA.
- **Two-tile type select.** The first decision is OFW/Employer vs FRA/Employment Agency. No phone-search path.
- **Manual entry is reference-code only.** Phone-number lookup is removed from the kiosk. The OFW/Employer entry screen carries the helper line `For Accreditation transaction, key in reference code (XXXXX-XXXXXXXX)`.
- **Auto-print on success.** Every successful kiosk check-in (including pickups) auto-prints. There is no print toggle on the kiosk path.

### State Management
- **ModeContext** is the single global state provider
- Contains: `mode`, `settings`, `loading`, `settingsOpen`
- Mode changes apply via `host.switchMode(mode)` → Rust `apply_kiosk_lock` (in-place)
- Settings updates persist immediately via `host.saveSettings`

### Component Patterns
- `ScannerInput` — captures HID barcode scanner input (keyboard emulation → Enter triggers callback)
- `useIdleTimer(ms, callback, enabled)` — auto-reset screens after inactivity (60s default in kiosk)
- `useScanner()` — low-level keyboard input hook for barcode detection (active on `TYPE_SELECT` and `ENTRY` only)
- `StatusBanner` — real-time Supabase connectivity indicator

---

## 8. Thermal Printing

### Pipeline
- Renderer calls `host.printTicket(data)` / `host.printQrTicket(data)` from `host-bridge.ts`.
- Bridge reads the configured printer name from the settings store and `invoke`s the corresponding Rust command.
- Rust (`src-tauri/src/print.rs`) builds an ESC/POS byte stream by hand (initialize, alignment, font-size, bold, native QR via `GS ( k`, partial cut) and sends it to the printer via the `printers` crate (Windows winspool RAW jobs).
- Date/time in SGT via `chrono::FixedOffset::east_opt(8 * 3600)`.

### Ticket Format (80mm)
```
    ┌──────────────────────────┐
    │   MIGRANT WORKERS OFFICE │
    │        SINGAPORE         │
    │ ── ── ── ── ── ── ── ── │
    │                          │
    │         6001             │  ← 5x size, bold
    │                          │
    │      SKILLED CV          │  ← 2x size, bold
    │     (or PICKUP - DH)     │
    │    JUAN DELA CRUZ        │  ← normal size
    │ ── ── ── ── ── ── ── ── │
    │   04 May 2026  09:15     │
    │                          │
    │ Please wait for your     │
    │ number to be called.     │
    └──────────────────────────┘
```

- **Print stack:** `printers` crate over winspool RAW jobs. Do not reintroduce HTML-to-print.
- **QR codes:** rendered natively via ESC/POS `GS ( k` command — pass the encoded text in `qrText`, not a PNG data URL.
- **Auto-print:** kiosk mode always; receptionist mode honors the `autoPrint` setting.

---

## 9. Compatibility with Nexus Backend

This app writes to Supabase. The Nexus backend reads from Supabase. They never communicate directly.

```
┌── Nexus Kiosk ────┐     ┌── Supabase ──────┐     ┌── Nexus Backend ──┐
│  Check-in app      │────▶│  kiosk_checkins   │◀────│  Queue processing │
│  (Internet LAN)    │     │  appointments     │     │  (Office LAN)     │
│                    │     │  fra_registrations │     │                   │
│                    │     │  submissions       │     │                   │
└────────────────────┘     └───────────────────┘     └───────────────────┘
```

### Compatibility Rules
- **Full ref_code storage** — always store the complete value. Never truncate. The Nexus backend uses prefix matching as a fallback, but this app should always provide the full value.
- **Queue numbers from RPC** — never calculate locally. The RPC ensures consistency across all apps.
- **SGT dates** — `queue_date` must always be SGT. Nexus filters by this date.
- **Status conventions** — receptionist mode writes `WAITING` (complete entry). Kiosk mode can write `PENDING` if it cannot resolve the service.
- **Priority values** — must match: 3 for appointments / FRA / pickups / OWWA walk-ins, 2 for regular walk-ins.
- **Display number format** — must use `formatQueueDisplay()` from `lib/constants.ts`.
- **Pickup marker** — the `kiosk_checkins.remarks` column carries `'PICKUP'` (or `'DEFERRED'`) so the receptionist console can distinguish pickup tickets from fresh check-ins. Eligibility filters mirror the Nexus pickup view (queue.service.ts:124-138).

### What Nexus Expects From Each Check-in
See AUDIT.md Section 4 for the exact column spec of `kiosk_checkins` rows.

---

## 10. Future: No-Receptionist System

The long-term goal is to eliminate the receptionist role entirely. Design decisions should support this trajectory:

### Current Barriers
1. **Walk-ins** — Currently require receptionist to enter name/service type manually
2. **Error recovery** — When QR scan fails, client needs human help
3. **FRA check-in** — Agencies may need guidance; currently staff-assisted
4. **Crowd management** — Receptionist currently manages the waiting area flow

### Design Principles for No-Receptionist
- Every error screen should have a clear self-service recovery path
- On-screen keyboard for walk-in self-registration (already implemented in receptionist mode)
- Reference-code fallback when QR fails
- Clear visual cues for each step (scan → processing → success/error)
- Consider: pre-registration via web/SMS where client gets QR before arriving
- Consider: real-time waiting area count display to manage crowd expectations

---

## 11. Off-Limits Folders and Files

Claude must never read, edit, delete, move, or reference:

**Folders:** `/secrets/`, `/config/private/`, `/.env*`, `/credentials/`, `/private/`, `/logs/`, `/backups/`, `/.ssh/`, `/.aws/`, `/.gcp/`

**Files:** `*.pem`, `*.key`, `*.pfx`, `secrets.json`, `credentials.json`, `service-account.json`, `*.secret`

### Behavior
- Do not read restricted files, even to summarize
- Do not infer secrets from context or variable names
- Do not write secrets into any file or output
- If a task requires a restricted path, stop and ask

---

## 12. Cross-Project Read Access

### AgencyHire (`c:\dbmwosg\agencyhire`)
May **read** for cross-reference only. Key files:
- `lib/supabase/types.ts` — Appointment, FraRegistration type definitions
- `lib/appointments/validations.ts` — Booking rules, status transitions
- `lib/timezone.ts` — SGT timezone handling

**Not allowed:** Edit, create, or delete any file in AgencyHire.

### Nexus (`c:\dbmwosg\nexus`)
May **read** to verify integration contracts. Key areas:
- `apps/backend/src/modules/kiosk-bridge/` — How Nexus processes kiosk check-ins
- `apps/backend/src/modules/queue/` — Queue status transitions, pickup eligibility filter
- `apps/backend/src/modules/fra/` — FRA processing workflow
- `apps/backend/src/modules/accreditation/` — Submissions trans_status semantics
- `apps/backend/src/modules/supabase/` — Supabase client and operations

**Not allowed:** Edit any file in the Nexus monorepo from this workspace.

---

## 13. What NOT to Do

- Do not generate NestJS, Express, FastAPI, or any backend framework code — this is a desktop app (Tauri/Electron host + React renderer)
- Do not reference Prisma, local PostgreSQL, or `@nexus/database` — this app has no local DB
- Do not generate queue numbers locally — always use the Supabase RPC
- Do not truncate ref_code or transaction_ref values
- Do not use UTC dates for queue_date — always SGT
- Do not store PII in the settings store or localStorage
- Do not hardcode Supabase keys in source code
- Do not use `any` — use `unknown` and narrow with Zod
- Do not skip the duplicate check before inserting a queue entry
- Do not bypass the kiosk lock in production builds
- Do not add walk-in registration to kiosk mode (no physical keyboard)
- Do not reintroduce icons in kiosk-mode screens
- Do not reintroduce phone-number lookup on the kiosk path
- Do not bypass the FRA 12pm cutoff (even via HID scan)
- Do not mix pickup and fresh check-in into the same queue series — pickups always use REGULAR (6000)
- Do not reintroduce HTML-to-print for thermal tickets — use ESC/POS bytes via the Rust command
- Do not edit `electron/` to add new features; new work belongs in `src-tauri/`. The Electron tree is fallback-only.
- Do not import from `@nexus/types` or `@nexus/database` — this project is standalone, not part of the monorepo
