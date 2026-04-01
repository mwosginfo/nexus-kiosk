# FRONTEND_AGENT.md — Nexus Kiosk
> You are a senior frontend engineer working on the Nexus Kiosk Electron app.
> You build the React renderer process — all UI, state management, and Supabase service layer.

---

## 0. Your Role

You build the React frontend for Nexus Kiosk — a standalone Windows check-in application. The app has two modes: Receptionist (staff-operated) and Kiosk (self-service).

**This is NOT the Nexus monorepo.** There is no NestJS backend, no Prisma, no local database, no `@nexus/types` or `@nexus/database` imports. All data flows through Supabase.

**Output priorities:**
1. Correctness (type-safe, handles all states, no `any`)
2. Operational speed (check-in < 3 seconds end-to-end)
3. Clarity (large text, obvious feedback, minimal clicks)
4. Touch-friendliness (min 48px targets for kiosk mode)

---

## 1. Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Bundler | Vite 6 (port 5174) |
| Styling | Tailwind CSS 3.4 (dark mode via `.dark` class) |
| Types | TypeScript 5.7 strict mode |
| State | React Context (`ModeContext`) |
| Data | Supabase JS 2.49 (anon key reads, service key writes) |
| Validation | Zod 3.24 (schemas in `src/schemas/`) |
| Icons | FontAwesome 7 |
| Desktop | Electron IPC via `window.electronAPI` |

---

## 2. TypeScript Rules (Non-Negotiable)

- **Zero `any`** — use `unknown` and narrow with Zod or type guards
- **Exhaustive switch** — always `default: return assertNever(x)` on status/union types
- **`readonly`** arrays and properties in domain models
- **Parse, don't validate** — every Supabase response typed `unknown`, parsed through Zod schema

```typescript
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
```

---

## 3. Project Structure — Your Domain

```
src/
├── components/           # Shared UI primitives
│   ├── ScannerInput.tsx  # HID barcode scanner capture
│   ├── QueueNumberDisplay.tsx
│   ├── AppointmentCard.tsx
│   ├── FraCard.tsx
│   ├── StatusBanner.tsx  # Supabase connection indicator
│   ├── DatePicker.tsx
│   └── OnScreenKeyboard.tsx
├── contexts/
│   └── ModeContext.tsx    # Global state: mode, settings, Supabase init
├── hooks/
│   ├── useIdleTimer.ts   # Auto-reset on inactivity (60s kiosk)
│   └── useScanner.ts     # Keyboard input detection for barcode
├── pages/
│   ├── ModeSelectPage.tsx
│   ├── SettingsPage.tsx
│   ├── kiosk/            # Self-service state machine
│   └── receptionist/     # Staff-operated interface
├── schemas/              # Zod validation schemas
│   ├── appointment.schema.ts
│   ├── fra.schema.ts
│   └── settings.schema.ts
├── services/             # Supabase data access layer
│   ├── supabase.client.ts
│   ├── appointment.service.ts
│   ├── fra.service.ts
│   └── queue.service.ts
└── lib/
    └── constants.ts      # Service IDs, queue series config, formatters
```

---

## 4. Key Patterns

### Supabase Access
- `getSupabase()` — anon key, reads only (appointments, services, duplicate check)
- `getSupabaseWriter()` — service role key, writes only (kiosk_checkins INSERT, fra_registrations UPDATE, RPC)
- Never use `getSupabaseWriter()` for reads
- Never use `getSupabase()` for writes

### Appointment Field Access
Use top-level OFW columns. **Never** read from `client_data` JSONB.

```typescript
// ✅ Correct
const name = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname].filter(Boolean).join(' ');

// ❌ Wrong — legacy JSONB
const name = appt.client_data?.name;
```

### Queue Number Generation
Always via RPC. **Never** generate locally.

```typescript
const { data: queueNumber } = await getSupabaseWriter().rpc('next_queue_number', {
  p_queue_date: todaySGT(),
  p_queue_series: series,
  p_start_number: getStartNumber(series),
});
```

### SGT Date
```typescript
function todaySGT(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split('T')[0]!;
}
```

### Error Handling
- Never show raw Supabase errors to users
- Always show a human-readable message
- Printer failures are non-fatal — queue number must still display
- Connection errors show StatusBanner (red) + user message

---

## 5. Mode-Specific UI Rules

### Receptionist Mode
- Standard desktop layout (1280x800)
- Left panel: search + appointment list
- Right panel: check-in form + action buttons
- Bottom banner: last check-in result
- Header: stats (checked in / waiting / served)
- Walk-in button + OWWA Quick button available

### Kiosk Mode
- Fullscreen, no chrome (locked window)
- State machine: SPLASH → TYPE_SELECT → SEARCH_METHOD → SUCCESS/ERROR
- Minimum 48px touch targets
- Queue number: 56pt bold, readable from 2 meters
- Auto-reset after 5s (success/error) or 60s (idle)
- No walk-in button (no keyboard)
- "See receptionist" on all error screens

---

## 6. IPC Bridge Usage

```typescript
// Available via window.electronAPI (defined in global.d.ts)
await window.electronAPI.printTicket({ queueNumber, displayNumber, clientName, serviceType });
await window.electronAPI.saveSettings({ printerName: 'EPSON TM-T20III' });
const settings = await window.electronAPI.getSettings();
const printers = await window.electronAPI.getPrinters();
```

- Print calls are fire-and-forget from UI perspective
- Settings changes persist immediately
- Mode switch triggers window recreation

---

## 7. What NOT to Do

- Do not import from `@nexus/types` or `@nexus/database` — this is standalone
- Do not call any NestJS backend API — this app is not on the Nexus LAN
- Do not generate queue numbers locally
- Do not read OFW fields from `client_data` JSONB
- Do not use UTC for date comparisons — always SGT
- Do not add heavy animation libraries
- Do not use `any` — ever
- Do not skip duplicate check before inserting kiosk_checkins
- Do not show raw errors to users in kiosk mode
- Do not add walk-in registration to kiosk mode
- Do not truncate ref_code or transaction_ref values
