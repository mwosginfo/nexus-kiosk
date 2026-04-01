# CLAUDE.md — Nexus Kiosk
> Authoritative context document for AI coding assistants working on this codebase.
> Read this fully before generating any code, component, or configuration change.

---

## 0. AI Assistant Workflow Rules

These rules apply to every task in this project, without exception.

### Before Writing Code
1. **Always PLAN first.** State the approach, identify affected files, and flag ambiguities before generating code.
2. **Check this CLAUDE.md** for relevant constraints before implementing anything.
3. This is a **standalone Electron app** — it is NOT the Nexus monorepo. There is no NestJS backend, no Prisma ORM, no local PostgreSQL database. All data flows through Supabase.

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
- **Kiosk Mode** — Unattended self-service. Client scans QR, gets queue number, ticket prints automatically.

### What This App Does
- Looks up appointments from Supabase
- Checks in clients by writing to Supabase `kiosk_checkins`
- Generates queue numbers via Supabase RPC (`next_queue_number`)
- Prints thermal queue tickets (58mm / 80mm)
- Manages FRA (agency) group check-ins
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
| Desktop Framework | Electron | 33.3.0 |
| Frontend | React | 19.0.0 |
| Bundler | Vite | 6.0.0 |
| Styling | Tailwind CSS | 3.4.17 |
| Database Access | Supabase JS | 2.49.0 |
| Runtime Schema | Zod | 3.24.0 |
| TypeScript | TypeScript | 5.7.0 (strict mode) |
| State Management | React Context | Built-in |
| Settings Store | electron-store | 8.2.0 |
| Icons | FontAwesome | 7.2.0 |
| Build | electron-builder (NSIS) | 25.1.0 |

### Project Structure
```
nexus-kiosk/
├── .claude/                    # AI documentation & agent definitions
│   ├── CLAUDE.md               # This file — master constraints
│   ├── WORKFLOWS.md            # User-facing check-in workflows
│   ├── DATABASE.md             # Supabase tables reference
│   ├── AUDIT.md                # Audit checklist for correctness
│   └── agents/                 # Specialized agent role files
├── electron/                   # Electron main process (Node.js)
│   ├── main.ts                 # Window creation, shortcuts, kiosk lock
│   ├── preload.ts              # Context bridge (IPC exposure)
│   ├── ipc/
│   │   ├── print.ipc.ts        # Thermal printer IPC handlers
│   │   └── settings.ipc.ts     # Settings persistence IPC handlers
│   └── services/
│       └── settings-store.ts   # electron-store schema & defaults
├── src/                        # React renderer process
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # Root component (mode switching)
│   ├── index.css               # Tailwind theme (light/dark)
│   ├── global.d.ts             # ElectronAPI type declarations
│   ├── components/             # Shared UI components
│   │   ├── ScannerInput.tsx    # HID barcode scanner input
│   │   ├── QueueNumberDisplay.tsx
│   │   ├── AppointmentCard.tsx
│   │   ├── FraCard.tsx
│   │   ├── StatusBanner.tsx    # Supabase connection indicator
│   │   ├── DatePicker.tsx
│   │   └── OnScreenKeyboard.tsx
│   ├── contexts/
│   │   └── ModeContext.tsx      # Global mode + settings state
│   ├── hooks/
│   │   ├── useIdleTimer.ts     # Auto-reset on inactivity
│   │   └── useScanner.ts       # Barcode scanner keyboard capture
│   ├── pages/
│   │   ├── ModeSelectPage.tsx  # Choose RECEPTIONIST or KIOSK
│   │   ├── SettingsPage.tsx    # Supabase + printer configuration
│   │   ├── kiosk/              # Self-service screens
│   │   │   ├── KioskLayout.tsx # State machine controller
│   │   │   ├── SplashScreen.tsx
│   │   │   ├── TypeSelectScreen.tsx
│   │   │   ├── SearchMethodScreen.tsx
│   │   │   ├── ManualSearchScreen.tsx
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
│   │   └── settings.schema.ts
│   ├── services/               # Supabase API layer
│   │   ├── supabase.client.ts  # Client initialization (anon + service key)
│   │   ├── appointment.service.ts
│   │   ├── fra.service.ts
│   │   └── queue.service.ts
│   └── lib/
│       └── constants.ts        # Service IDs, queue series, formatting
├── supabase/                   # Supabase configuration
├── index.html                  # HTML shell
├── package.json
├── tsconfig.json               # Strict TypeScript config
├── tsconfig.electron.json      # Electron-specific TS config
├── vite.config.ts              # Vite bundler (port 5174)
├── tailwind.config.ts          # Tailwind theme
├── electron-builder.yml        # NSIS installer config
└── postcss.config.js
```

### Build & Run
```bash
npm run dev               # Vite dev server (port 5174)
npm run dev:electron      # Vite + Electron for development
npm run build             # Compile TypeScript + bundle React + compile Electron
npm run build:electron    # Build Windows NSIS installer → release/
```

---

## 3. Architecture — Two Process Model

Electron apps have two processes. Understanding the boundary is critical for security.

```
┌─── Main Process (Node.js) ──────────────────────────┐
│  electron/main.ts                                    │
│  - Window management, kiosk lock, global shortcuts   │
│  - electron-store (settings persistence)             │
│  - Thermal printer access (via IPC)                  │
│  - Has access to service role key (secure)           │
└──────────┬───────────────────────────────────────────┘
           │  IPC (context bridge)
┌──────────┴───────────────────────────────────────────┐
│  Renderer Process (React)                            │
│  src/App.tsx                                         │
│  - All UI rendering                                  │
│  - Supabase reads (anon key)                         │
│  - Supabase writes (service key via getSupabaseWriter)│
│  - Mode state machine                                │
│  - Scanner input handling                            │
└──────────────────────────────────────────────────────┘
```

### IPC Bridge (`window.electronAPI`)
| Method | Direction | Purpose |
|--------|-----------|---------|
| `getSettings()` | Renderer → Main | Load persisted settings |
| `saveSettings(partial)` | Renderer → Main | Persist setting changes |
| `printTicket(data)` | Renderer → Main | Print thermal queue ticket |
| `getPrinters()` | Renderer → Main | List available printers |
| `switchMode(mode)` | Renderer → Main | Recreate window for mode |
| `onToggleSettings(cb)` | Main → Renderer | Ctrl+Shift+S pressed |

### Global Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Toggle settings overlay |
| `Ctrl+Shift+Q` | Quit application (with confirmation) |

---

## 4. Supabase Integration — The Only Data Source

This app has **no local database**. All data comes from and goes to Supabase.

### Two Supabase Clients
| Client | Key | Purpose |
|--------|-----|---------|
| `getSupabase()` | Anon key | Read: appointments, fra_registrations, services |
| `getSupabaseWriter()` | Service role key | Write: kiosk_checkins INSERT, fra_registrations UPDATE |

Both clients are initialized lazily in `src/services/supabase.client.ts`.

### Supabase Tables — Access Matrix

| Table | Read | Write | Key Columns |
|-------|------|-------|-------------|
| `appointments` | YES | NO | `ref_code`, `service_id`, `ofw_fname/lname/mname`, `client_email`, `client_contact`, `status`, `appointment_date` |
| `fra_registrations` | YES | Limited | `transaction_ref`, `pra`, `fra`, `status`, `appointment_date`, `arrived_at` |
| `services` | YES | NO | `id`, `slug` — maps service_id to queue series |
| `kiosk_checkins` | Duplicate check | YES (INSERT) | See AUDIT.md Section 4 for full column spec |

### Queue Number Generation — CRITICAL

**Always use the Supabase RPC. Never generate queue numbers locally.**

```typescript
const { data } = await supabase.rpc('next_queue_number', {
  p_queue_date: todaySGT(),       // "2026-03-31"
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
// ✅ Correct
function todaySGT(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().split('T')[0];
}

// ❌ WRONG — gives yesterday between midnight and 8am SGT
new Date().toISOString().split('T')[0]
```

### 5.2 Ref Code Format Detection

```typescript
function detectScanType(value: string): 'APPOINTMENT' | 'FRA' | 'UNKNOWN' {
  // FRA: UUID format (36 chars with hyphens)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    return 'FRA';
  // Appointment: 6-10 char alphanumeric uppercase
  if (/^[A-Z0-9]{6,10}$/.test(value))
    return 'APPOINTMENT';
  // FRA: 20-30 char alphanumeric (non-UUID format)
  if (/^[A-Z0-9]{20,30}$/i.test(value))
    return 'FRA';
  return 'UNKNOWN';
}
```

### 5.3 Client Name Display

Appointment data stores names in `ofw_fname`, `ofw_mname`, `ofw_lname`.

```typescript
// ✅ Always use this pattern
const fullName = [ofw_fname, ofw_mname, ofw_lname].filter(Boolean).join(' ');

// ❌ Never do this — breaks if mname is null
const fullName = `${ofw_fname} ${ofw_mname} ${ofw_lname}`;
```

### 5.4 Appointment Field Access

OFW fields are **dedicated top-level columns** on the `appointments` table:
- `ofw_fname`, `ofw_lname`, `ofw_mname`
- `ofw_gender`, `ofw_visa`, `ofw_position`, `ofw_trans`
- `client_contact`, `p_name`

**Do NOT read these from `client_data` JSONB.** The JSONB is legacy; top-level columns are authoritative.

### 5.5 FRA Check-in Window

FRA registrations can be checked in from appointments **up to 14 days old** (not just today). This is intentional — agencies sometimes check in for prior-date appointments.

### 5.6 Duplicate Prevention

Before every check-in, query `kiosk_checkins` for today's date + ref_code. If a match exists (status not FAILED), show the existing queue number instead of creating a duplicate.

### 5.7 Priority System

| Check-in Type | Priority | Effect |
|---|---|---|
| Appointment / FRA | 3 | Called first by Nexus backend |
| Walk-in | 7 | Called after all priority-3 entries |

Lower number = higher priority.

---

## 6. Security Rules

### Keys & Secrets
- **Anon key** — used for reads (appointments, services). Safe to be in renderer process via env vars.
- **Service role key** — used for writes (kiosk_checkins INSERT, fra_registrations UPDATE). Stored in electron-store settings, accessed via `getSupabaseWriter()`.
- Service role key must **never** be hardcoded in source code.
- All keys come from `.env` (build-time defaults) or runtime settings (electron-store).

### Kiosk Mode Lock
When `mode === 'KIOSK'` and `rememberMode === true`:
- Window is fullscreen
- No menu bar, no address bar, no dev tools
- Cannot navigate away from kiosk UI
- Only `Ctrl+Shift+S` (settings) and `Ctrl+Shift+Q` (quit) work

### Data Handling
- This app does **not** store PII locally beyond the current session
- electron-store persists only: mode, Supabase credentials, printer settings
- No client data is cached between sessions
- Thermal ticket prints contain: queue number, service type, client name, date/time

---

## 7. Frontend Rules

- **React 19 + Tailwind CSS 3.4**, bundled with **Vite 6**
- UI philosophy: **Speed and clarity for 1-second interactions.** Every check-in should complete in under 3 seconds.
- Dark mode via CSS `.dark` class on `<html>`, managed by `ModeContext`
- Do not add animation libraries or heavy dependencies — this runs on office hardware
- Large, high-contrast text for kiosk mode (readable from 2 meters)
- Touch-friendly targets (min 48px) for kiosk/tablet use

### State Management
- **ModeContext** is the single global state provider
- Contains: `mode`, `settings`, `loading`, `settingsOpen`
- Mode changes recreate the Electron window (via IPC `switchMode`)
- Settings updates persist immediately via electron-store

### Component Patterns
- `ScannerInput` — captures HID barcode scanner input (keyboard emulation → Enter triggers callback)
- `useIdleTimer(ms, callback, enabled)` — auto-reset screens after inactivity (60s default in kiosk)
- `useScanner()` — low-level keyboard input hook for barcode detection
- `StatusBanner` — real-time Supabase connectivity indicator

---

## 8. Thermal Printing

### Ticket Format (80mm)
```
    ┌──────────────────────────┐
    │   MIGRANT WORKERS OFFICE │
    │        SINGAPORE         │
    │ ── ── ── ── ── ── ── ── │
    │                          │
    │         6001             │  ← 56pt bold monospace
    │                          │
    │      SKILLED CV          │  ← 11pt bold
    │    JUAN DELA CRUZ        │  ← 10pt semibold
    │ ── ── ── ── ── ── ── ── │
    │   31 Mar 2026  09:15     │  ← 9pt
    │                          │
    │ Please wait for your     │  ← 8pt
    │ number to be called.     │
    └──────────────────────────┘
```

- Supported widths: 58mm (narrow) and 80mm (standard)
- Printing via Electron IPC → system printer API
- Auto-print toggle available in receptionist mode
- Kiosk mode always auto-prints on success

---

## 9. Compatibility with Nexus Backend

This app writes to Supabase. The Nexus backend reads from Supabase. They never communicate directly.

```
┌── Nexus Kiosk ────┐     ┌── Supabase ──────┐     ┌── Nexus Backend ──┐
│  Check-in app      │────▶│  kiosk_checkins   │◀────│  Queue processing │
│  (Internet LAN)    │     │  appointments     │     │  (Office LAN)     │
│                    │     │  fra_registrations │     │                   │
└────────────────────┘     └───────────────────┘     └───────────────────┘
```

### Compatibility Rules
- **Full ref_code storage** — always store the complete value. Never truncate. The Nexus backend uses prefix matching as a fallback, but this app should always provide the full value.
- **Queue numbers from RPC** — never calculate locally. The RPC ensures consistency across all apps.
- **SGT dates** — `queue_date` must always be SGT. Nexus filters by this date.
- **Status conventions** — receptionist mode writes `WAITING` (complete entry). Kiosk mode can write `PENDING` if it cannot resolve the service.
- **Priority values** — must match: 3 for appointments/FRA, 7 for walk-ins.
- **Display number format** — must use `formatQueueDisplay()` from `lib/constants.ts`.

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
- On-screen keyboard for walk-in self-registration (already implemented)
- Phone number lookup as fallback when QR fails
- Clear visual/audio cues for each step (scan → processing → success/error)
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
- `apps/backend/src/modules/queue/` — Queue status transitions
- `apps/backend/src/modules/fra/` — FRA processing workflow
- `apps/backend/src/modules/supabase/` — Supabase client and operations

**Not allowed:** Edit any file in the Nexus monorepo from this workspace.

---

## 13. What NOT to Do

- Do not generate NestJS, Express, FastAPI, or any backend framework code — this is an Electron app
- Do not reference Prisma, local PostgreSQL, or `@nexus/database` — this app has no local DB
- Do not generate queue numbers locally — always use the Supabase RPC
- Do not truncate ref_code or transaction_ref values
- Do not use UTC dates for queue_date — always SGT
- Do not store PII in electron-store or localStorage
- Do not hardcode Supabase keys in source code
- Do not use `any` — use `unknown` and narrow with Zod
- Do not skip the duplicate check before inserting a queue entry
- Do not bypass the kiosk lock in production builds
- Do not add walk-in registration to kiosk mode (no physical keyboard)
- Do not import from `@nexus/types` or `@nexus/database` — this project is standalone, not part of the monorepo
