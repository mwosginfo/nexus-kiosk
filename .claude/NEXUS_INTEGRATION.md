# NEXUS_INTEGRATION.md — Kiosk ↔ Nexus Developer Reference

> Reference document for Nexus backend developers.
> Everything the backend needs to know about what the kiosk writes,
> how to read it, and what to expect.
>
> **Last verified against code:** 2026-04-01

---

## 1. What the Kiosk Does

The kiosk is a standalone Electron app on a separate network. It connects **only** to Supabase — never to the Nexus backend API. All coordination happens through shared Supabase tables.

```
┌── Nexus Kiosk ────────────┐     ┌── Supabase ────────────┐     ┌── Nexus Backend ────────┐
│  Standalone Electron app   │     │                        │     │  NestJS on Office LAN   │
│  (Internet / separate LAN) │     │  kiosk_checkins        │     │                         │
│                            │────▶│  appointments          │◀────│  Queue processing       │
│  WRITES:                   │     │  fra_registrations     │     │  OR issuance            │
│    kiosk_checkins (INSERT)  │     │  services             │     │  Receipt printing       │
│    fra_registrations (UPD) │     │                        │     │                         │
│    appointments (UPD)      │     └────────────────────────┘     └─────────────────────────┘
│                            │
│  READS:                    │
│    appointments            │
│    fra_registrations       │
│    services                │
│    kiosk_checkins (dupes)  │
└────────────────────────────┘
```

### Actions Performed
1. **Appointment check-in** — lookup by ref_code → validate → generate queue number → INSERT kiosk_checkins → UPDATE appointments.appt_status = 'ARRIVED'
2. **FRA check-in** — lookup by transaction_ref (14-day window) → generate queue number → INSERT kiosk_checkins → UPDATE fra_registrations.status = 'arrived'
3. **Walk-in registration** — receptionist enters name/service → generate queue number → INSERT kiosk_checkins (priority 7)
4. **OWWA quick queue** — one-click → generate queue number → INSERT kiosk_checkins (no client details, priority 7)

### Actions NOT Performed
- Does NOT call clients to counters
- Does NOT process transactions or issue OR numbers
- Does NOT manage the queue display TV
- Does NOT connect to the Nexus backend API
- Does NOT write to local PostgreSQL

---

## 2. Supabase Service IDs — Hardcoded Constants

These UUIDs are hardcoded in the kiosk app. If they change in Supabase, the kiosk must be updated and redeployed.

```
SKILLED_CV      30c55940-083c-434a-8212-e810f2fa37b2
MDW_CV          cc50f069-1dc6-48ac-9e04-dbaf2a28b839
DH              ff4eeaf1-0009-4664-b9d8-6ea48de0f745
OWWA            23470e2d-397e-4a24-b3ee-f55ed3fec65c
FRA             7b9257b9-b2b6-404c-b277-c585ef27ec34
```

### Slug → Queue Series Mapping

The kiosk resolves `services.slug` → queue series. Fallback by service_id if slug lookup fails.

| Slug | Queue Series | Service Type | Start # | Display Format |
|------|-------------|--------------|---------|----------------|
| `skilled-cv` | `REGULAR` | `SKILLED_CV` | 6001 | `6001`, `6002` |
| `mdw-cv` | `REGULAR` | `MDW_CV` | 6001 | `6001`, `6002` |
| `dh` | `REGULAR` | `DH` | 6001 | `6001`, `6002` |
| `owwa` | `OWWA` | `OWWA` | 9001 | `9001`, `9002` |
| `fra-registration` | `FRA` | `FRA_REGISTRATION` | 1 | `A001`, `A002` |
| `accreditation` | `REGULAR` | `ACCREDITATION` | 6001 | `6001`, `6002` |

### Walk-in Series

| Walk-in Type | Queue Series | Start # | Display Format |
|-------------|-------------|---------|----------------|
| CV / DH | `WALKIN_REGULAR` | 601 | `W601`, `W602` |
| OWWA (quick queue) | `OWWA` | 9001 | `9001`, `9002` |

> **Note:** OWWA quick queue uses the main `OWWA` series (not `WALKIN_OWWA`), as confirmed by operations. OWWA walk-ins are served in the same queue as OWWA appointments.

---

## 3. kiosk_checkins — Exact Insert Payload

Every kiosk check-in produces exactly **one row** in `kiosk_checkins`. This is the complete set of columns the kiosk writes:

```sql
INSERT INTO kiosk_checkins (
  ref_code,           -- TEXT NOT NULL: full QR scan value (never truncated)
  appointment_type,   -- TEXT NOT NULL: 'APPOINTMENT' | 'FRA' | 'WALKIN'
  queue_number,       -- INT: from next_queue_number() RPC
  display_number,     -- TEXT: formatted (e.g., '6001', 'A003', 'W601')
  queue_series,       -- TEXT: 'REGULAR' | 'OWWA' | 'FRA' | 'WALKIN_REGULAR'
  service_type,       -- TEXT: 'SKILLED_CV' | 'MDW_CV' | 'DH' | 'OWWA' | 'FRA_REGISTRATION' | 'ACCREDITATION'
  status,             -- TEXT: always 'WAITING'
  client_name,        -- TEXT: [fname, mname, lname].filter(Boolean).join(' ')
  client_email,       -- TEXT nullable: from appointment, NULL for FRA/some walk-ins
  appointment_id,     -- UUID nullable: appointment UUID for appointments, NULL for FRA/walk-ins
  transaction_ref,    -- TEXT: same as ref_code for appointments; transaction_ref for FRA
  queue_date,         -- TEXT: today in SGT 'YYYY-MM-DD'
  priority,           -- SMALLINT: 3 (appointment/FRA) or 7 (walk-in)
  call_count          -- SMALLINT: always 0
) VALUES (...);
```

### Columns the Kiosk Does NOT Write

These are backend-only. The kiosk never touches them:

```
assigned_to, counter_number, called_at, completed_at,
remarks, deferral_reason, error_message, processed_at, last_called_at
```

### Status Convention

The kiosk **always writes `status = 'WAITING'`** because it fully resolves the service, generates the queue number via RPC, and builds the complete entry.

The `PENDING` status path exists for simpler kiosk clients that cannot resolve services or generate queue numbers — the Nexus kiosk-bridge processes those. This kiosk does not use that path.

**Implication for Nexus:** The kiosk-bridge's `PENDING` subscription will **never fire** for entries from this kiosk. All entries arrive as `WAITING` and are immediately available for `callNext()`.

---

## 4. Queue Number Generation — `next_queue_number()` RPC

The kiosk calls this RPC for every check-in. It is the **only** source of queue numbers.

```sql
SELECT next_queue_number(
  p_queue_date    := '2026-04-01',   -- SGT date (never UTC)
  p_queue_series  := 'REGULAR',      -- or 'OWWA', 'FRA', 'WALKIN_REGULAR'
  p_start_number  := 6001            -- first number in this series
);
```

### RPC Internals (for reference)

```sql
CREATE OR REPLACE FUNCTION next_queue_number(
  p_queue_date DATE,
  p_queue_series TEXT,
  p_start_number INT DEFAULT 6001
) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_next INT;
  v_lock_id BIGINT;
BEGIN
  v_lock_id := hashtext(p_queue_date::text || '::' || p_queue_series);
  PERFORM pg_advisory_xact_lock(v_lock_id);

  SELECT COALESCE(MAX(queue_number), p_start_number - 1) + 1
  INTO v_next
  FROM kiosk_checkins
  WHERE queue_date = p_queue_date
    AND queue_series = p_queue_series
    AND queue_number IS NOT NULL;

  RETURN v_next;
END;
$$;
```

**Concurrency:** Uses `pg_advisory_xact_lock` keyed to `(date, series)`. Multiple kiosks + the Nexus backend can call this simultaneously without generating duplicate numbers.

### Start Numbers (p_start_number values)

| Series | p_start_number | First Number Returned |
|--------|---------------|-----------------------|
| `REGULAR` | `6001` | `6001` |
| `OWWA` | `9001` | `9001` |
| `FRA` | `1` | `1` |
| `WALKIN_REGULAR` | `601` | `601` |

---

## 5. Priority System

Queue calling order is determined by `priority` (ASC) then `queue_number` (ASC).

| Priority | Who Gets It | Set By |
|----------|-------------|--------|
| **3** | Appointment check-ins (all services) | Kiosk: `appointmentType !== 'WALKIN'` |
| **3** | FRA agency check-ins | Kiosk: `appointmentType === 'FRA'` |
| **5** | Default (Supabase column default) | Not set explicitly by anyone — safety net |
| **7** | Walk-in registrations | Kiosk: `appointmentType === 'WALKIN'` |
| **7** | OWWA quick queue (walk-in) | Kiosk: `appointmentType === 'WALKIN'` |

**Nexus callNext() sort:** `.order('priority', { ascending: true }).order('queue_number', { ascending: true })`

**Effect:** All priority-3 entries are called before any priority-7 entries within the same queue series. Within the same priority, FIFO by queue_number.

---

## 6. Status Lifecycle

### What the Kiosk Writes

```
(nothing) ──INSERT──▶ WAITING (with queue_number, priority, call_count=0)
```

### What the Kiosk Also Updates (on Supabase, fire-and-forget)

```
appointments.appt_status = 'ARRIVED'     (on successful appointment check-in)
fra_registrations.status = 'arrived'      (on successful FRA check-in)
fra_registrations.arrived_at = NOW()      (on successful FRA check-in)
```

### Full Status Lifecycle (Nexus Manages the Rest)

```
WAITING ──callNext──▶ CALLED ──serve──▶ PROCESSING ──submit──▶ SUBMITTED ──▶ PROCESSED ──▶ OR_ISSUED
                        │                    │
                        ├──miss──▶ MISSED    ├──defer──▶ DEFERRED
                        │                    │
                        └──defer──▶ DEFERRED └──(FRA)──▶ CONFIRMED ──▶ PROCESSED ──▶ OR_ISSUED

OWWA: WAITING ──call──▶ CALLED ──auto(5s)──▶ RECEIVED (terminal)

Terminal states: OR_ISSUED, MISSED, DEFERRED, RECEIVED
```

### Auto-Miss Threshold

Nexus auto-misses an entry when `call_count > 3` (4th call triggers MISSED). The kiosk always initializes `call_count = 0`.

**Known issue in Nexus:** When reactivating a DEFERRED entry (`reactivateDeferred()`, `reenterDeferred()`, `checkInFra()` deferred return), `call_count` is **not reset to 0**. A client who was called twice before deferral re-enters with `call_count = 2` and may be auto-missed after one additional call.

---

## 7. Duplicate Prevention

Before every INSERT, the kiosk queries:

```sql
SELECT id, queue_number, display_number, status
FROM kiosk_checkins
WHERE ref_code = $1
  AND queue_date = $today_sgt
  AND status NOT IN ('FAILED', 'DEFERRED')
LIMIT 1;
```

| Existing Status | Kiosk Behavior |
|----------------|----------------|
| WAITING, CALLED, PROCESSING, etc. | **Blocks** re-scan. Shows "Already checked in as Q#XXXX" |
| FAILED | **Allows** re-scan (retry) |
| DEFERRED | **Allows** re-scan (new queue number issued) |
| No entry for today | **Allows** check-in |

**Implication for Nexus:** If Nexus defers an entry, the client can re-scan at the kiosk and get a **new** queue number. The old DEFERRED entry remains in the table. Both entries share the same `ref_code` but have different `queue_number` values.

---

## 8. Ref Code Format Detection

The kiosk auto-detects the scan type from the QR code value:

```
UUID (36 chars with hyphens)          → FRA check-in path
  e.g., 550e8400-e29b-41d4-a716-446655440000

6-10 char uppercase alphanumeric      → Appointment check-in path
  e.g., ABC12345, XY789012

20-30 char alphanumeric               → FRA check-in path (non-UUID format)
  e.g., ABCDEFGHIJKLMNOPQRSTUVWX
```

The `ref_code` is stored **in full** — never truncated. Nexus uses prefix matching as a fallback (`.like('${ref.slice(0,12)}%')`), but the kiosk always provides the complete value.

---

## 9. FRA Check-in Details

### Lookup Window

FRA registrations are searched within the **past 14 days** only:

```sql
SELECT * FROM fra_registrations
WHERE transaction_ref = $1
  AND appointment_date >= (TODAY_SGT - 14 days)
  AND appointment_date <= TODAY_SGT
  AND status != 'cancelled'
LIMIT 1;
```

No future-dated FRA registrations are allowed.

### Status Update

On successful check-in, the kiosk fires-and-forgets:

```sql
UPDATE fra_registrations
SET status = 'arrived', arrived_at = NOW()
WHERE id = $fra_id;
```

### What Nexus Should Expect

- FRA entries in `kiosk_checkins` have `appointment_type = 'FRA'`, `queue_series = 'FRA'`, `service_type = 'FRA_REGISTRATION'`
- `transaction_ref` contains the full FRA UUID (or long alphanumeric ref)
- `client_name` contains the FRA agency name (from `fra_registrations.fra` field)
- `appointment_id` is NULL (FRA entries don't link to the appointments table)
- `client_email` is NULL
- `priority` is 3 (same as regular appointments)

---

## 10. Appointment Check-in Details

### Lookup

```sql
SELECT * FROM appointments WHERE ref_code = $upper_trimmed_value LIMIT 1;
```

### Validation

| Check | Condition | Kiosk Action |
|-------|-----------|-------------|
| Not found | No row returned | Error: "No appointment found" |
| Terminal status | status IN ('cancelled', 'completed', 'no_show') | Error: "Appointment is [status]" |
| Wrong date | appointment_date ≠ today SGT | Error: "Appointment is for [date], not today" |
| Already checked in | Existing kiosk_checkins entry (non-FAILED, non-DEFERRED) | Shows existing Q# |

### Status Update

On successful check-in:

```sql
UPDATE appointments SET appt_status = 'ARRIVED' WHERE id = $appointment_id;
```

**Column:** `appt_status` (operational status), NOT `status` (booking status). This matches Nexus backend's `updateAppointmentStatus()` method.

### Appointment Fields Used

OFW fields are read from **top-level columns**, NOT from `client_data` JSONB:

| Field | Column | Used For |
|-------|--------|----------|
| First name | `ofw_fname` | client_name in kiosk_checkins |
| Middle name | `ofw_mname` | client_name (if not null) |
| Last name | `ofw_lname` | client_name |
| Email | `client_email` | client_email in kiosk_checkins |
| Phone | `client_contact` | Phone search fallback |
| Service | `service_id` | Queue series resolution |
| Appointment ID | `id` | appointment_id in kiosk_checkins |
| Ref code | `ref_code` | ref_code + transaction_ref in kiosk_checkins |

---

## 11. Walk-in Registration Details

Walk-ins are receptionist-mode only (not available in kiosk self-service mode).

### Generated Ref Code

Format: `W-XXXXXXXX` (8 random chars from charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)

### Insert Payload

```
appointment_type  = 'WALKIN'
queue_series      = 'WALKIN_REGULAR'
service_type      = 'SKILLED_CV' or 'MDW_CV' (selected by receptionist)
status            = 'WAITING'
priority          = 7
call_count        = 0
client_name       = [fname, mname, lname].filter(Boolean).join(' ')
client_email      = entered email (trimmed, lowercased)
appointment_id    = NULL
transaction_ref   = same as ref_code (W-XXXXXXXX)
```

### OWWA Quick Queue

Same as walk-in but:

```
ref_code          = 'OWWA-XXXXXXXX'
appointment_type  = 'WALKIN'
queue_series      = 'OWWA'
service_type      = 'OWWA'
priority          = 7
client_name       = '' (empty)
client_email      = NULL
```

---

## 12. Display Number Formatting

```typescript
function formatQueueDisplay(queueNumber: number, series: string): string {
  switch (series) {
    case 'FRA':            return `A${String(queueNumber).padStart(3, '0')}`;  // A001, A002
    case 'WALKIN_REGULAR': return `W${queueNumber}`;                           // W601, W602
    default:               return String(queueNumber);                         // 6001, 9001
  }
}
```

**Nexus must use the same formatting** for the Queue Display TV and printed receipts. If the kiosk stores `display_number = 'A003'`, Nexus should show `A003` on the TV — not `3` or `FRA-3`.

---

## 13. Timezone — SGT (UTC+8) — CRITICAL

**All dates in the kiosk are Singapore Time. Never UTC.**

```typescript
function todaySGT(): string {
  const now = new Date();
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);  // "2026-04-01"
}
```

The `queue_date` column is set to `todaySGT()` on every insert. Nexus filters by this date.

**Edge case:** At 11:55 PM SGT (= 3:55 PM UTC), the kiosk writes today's SGT date. At 12:05 AM SGT (= 4:05 PM yesterday UTC), the kiosk writes the new SGT date. Queue numbers reset at midnight SGT.

---

## 14. Supabase RLS & Access

| Table | RLS Enabled | Anon Access | Service Role Access |
|-------|------------|-------------|-------------------|
| `appointments` | YES | NO (denied) | Full CRUD |
| `kiosk_checkins` | YES | NO (denied) | Full CRUD |
| `fra_registrations` | NO | Yes (no RLS) | Full CRUD |
| `services` | YES | Read only | Full CRUD |

The kiosk uses the **service role key** for all operations. The anon key cannot read `appointments` or `kiosk_checkins` due to RLS policies.

---

## 15. Rate Limiting

The kiosk enforces a client-side rate limit: **max 10 check-ins per 60 seconds**. If exceeded, the user sees "Too many check-ins in a short time" and must wait.

This is a safety measure against accidental rapid scanning, not a security control. The Supabase RPC's advisory lock provides the real concurrency protection.

---

## 16. Kiosk-Bridge Interaction

The Nexus kiosk-bridge module subscribes to `kiosk_checkins` INSERTs with `filter: status=eq.PENDING` and polls every 5 seconds for PENDING entries.

**This kiosk writes `status = 'WAITING'`, so the kiosk-bridge will never process its entries.** The bridge only activates for simpler clients that write PENDING entries needing enrichment.

If you want the kiosk-bridge to process entries from this kiosk (e.g., for centralized validation), the kiosk would need to be changed to write `PENDING` instead of `WAITING`. Currently not planned.

---

## 17. Bug Report — Nexus Backend Fixes Required

> **Reported:** 2026-04-01 | **Verified against:** Nexus backend source code
> These bugs exist in the Nexus backend, NOT in the kiosk app.

---

### BUG-1: call_count not reset on reactivation (HIGH)

**Impact:** A client who was called 2+ times before being deferred will be auto-missed on their very first call after re-entry. The auto-miss threshold is `call_count > 3`, but the old count carries over.

**Affected code paths (3 locations):**

**Location 1:** `apps/backend/src/modules/queue/queue.service.ts` — `reactivateDeferred()` (~line 460-470)
```typescript
// CURRENT (BROKEN) — call_count not included in update
const updated = await this.supabaseService.updateQueueEntry(queueId, {
  status: 'WAITING',
  queue_date: today,
  queue_number: nextNumber,
  display_number: formatQueueDisplay(nextNumber, series),
  completed_at: null,
  called_at: null,
  assigned_to: null,
  counter_number: null,
  deferral_reason: null,
});

// FIX — add call_count: 0
const updated = await this.supabaseService.updateQueueEntry(queueId, {
  status: 'WAITING',
  queue_date: today,
  queue_number: nextNumber,
  display_number: formatQueueDisplay(nextNumber, series),
  completed_at: null,
  called_at: null,
  assigned_to: null,
  counter_number: null,
  deferral_reason: null,
  call_count: 0,              // ← ADD THIS
});
```

**Location 2:** `apps/backend/src/modules/queue/queue.service.ts` — `reenterDeferred()` (~line 617-627)
```typescript
// CURRENT (BROKEN)
await this.supabaseService.updateQueueEntry(existing.id, {
  status: 'WAITING',
  queue_date: today,
  queue_number: nextNumber,
  display_number: formatQueueDisplay(nextNumber, series),
  called_at: null,
  completed_at: null,
  assigned_to: null,
  counter_number: null,
  remarks: `Returned (deferred) by ${staffUsername}`,
});

// FIX — add call_count: 0
await this.supabaseService.updateQueueEntry(existing.id, {
  status: 'WAITING',
  queue_date: today,
  queue_number: nextNumber,
  display_number: formatQueueDisplay(nextNumber, series),
  called_at: null,
  completed_at: null,
  assigned_to: null,
  counter_number: null,
  remarks: `Returned (deferred) by ${staffUsername}`,
  call_count: 0,              // ← ADD THIS
});
```

**Location 3:** `apps/backend/src/modules/fra/fra.service.ts` — `checkInFra()` deferred return (~line 256-266)
```typescript
// CURRENT (BROKEN)
await this.supabaseService.updateQueueEntry(deferredFra.id, {
  status: 'WAITING',
  queue_number: nextNumber,
  display_number: displayNumber,
  queue_date: todayStr,
  called_at: null,
  completed_at: null,
  assigned_to: null,
  counter_number: null,
  remarks: `Re-entered from deferred by ${staffUsername}`,
});

// FIX — add call_count: 0
await this.supabaseService.updateQueueEntry(deferredFra.id, {
  status: 'WAITING',
  queue_number: nextNumber,
  display_number: displayNumber,
  queue_date: todayStr,
  called_at: null,
  completed_at: null,
  assigned_to: null,
  counter_number: null,
  remarks: `Re-entered from deferred by ${staffUsername}`,
  call_count: 0,              // ← ADD THIS
});
```

**Note:** The `reenterDeferred()` "new entry" path (line ~690) correctly calls `addToQueue()` which sets `call_count: 0`. Only the "existing entry update" paths are broken.

---

### BUG-2: Dual kiosk listeners — race condition (MEDIUM, latent)

**Impact:** If any client writes `status = 'PENDING'` to `kiosk_checkins`, both `SupabaseService` and `KioskBridgeService` will race to process it. One sets status to `WAITING`, the other to `PROCESSED`. Outcome depends on timing.

**Currently latent** because the kiosk writes `WAITING` directly, bypassing both listeners. Would activate if a simpler kiosk or mobile client writes PENDING.

**Location 1 — remove this subscription:**
`apps/backend/src/modules/supabase/supabase.service.ts` — `subscribeToKioskCheckins()` (~line 176-199)
```typescript
// This entire method subscribes to kiosk_checkins INSERTs
// and calls handleKioskCheckin() — DUPLICATES KioskBridgeService
private subscribeToKioskCheckins(): void {
  // ... subscription code
}
```

Also remove the call to `subscribeToKioskCheckins()` and `processPendingKioskCheckins()` from `onModuleInit()` (~line 87-91).

**Keep only:** `apps/backend/src/modules/kiosk-bridge/kiosk-bridge.service.ts` — this has the subscription with `filter: 'status=eq.PENDING'` plus 5-second polling fallback.

**Fix:** Delete `subscribeToKioskCheckins()` and `processPendingKioskCheckins()` from `supabase.service.ts`. Let `KioskBridgeService` be the single processor.

---

### BUG-3: Service mapping duplication (LOW, maintenance risk)

**Impact:** Slug → series mapping exists in 4+ locations. If a new service is added or a slug changes, it must be updated in all locations or behavior will diverge silently.

**Locations:**

| File | What It Maps | Line |
|------|-------------|------|
| `kiosk-bridge.service.ts` | `SERVICE_SLUG_MAP`: slug → ServiceType | ~29-36 |
| `queue.service.ts` | `slugMap`: ServiceType → slug (reverse) | ~850-857 |
| `queue.service.ts` | `map`: slug → ServiceType | ~930-936 |
| `queue.service.ts` | `seriesMap`: hint → QueueSeries | ~658-662 |
| **nexus-kiosk** `constants.ts` | `SLUG_MAP`: slug → {series, serviceType} | 27-34 |

**Notable mismatch:** `queue.service.ts` mapping B (~line 930) is **missing the `owwa` slug** entirely.

**Fix:** Extract to a single shared constant in `@nexus/types` or a shared module. All consumers import from one source. The kiosk maintains its own copy (separate repo) but should match.

---

### BUG-4: No Supabase realtime health monitoring (LOW)

**Impact:** If the Supabase realtime connection drops, the only indication is a `console.warn`. No admin notification, no health endpoint status, no reconnection logic.

**Mitigated by:** KioskBridgeService's 5-second polling fallback catches missed events. Data loss is unlikely but latency increases to ~5s during outages.

**Locations:**
- `supabase.service.ts` ~line 126: logs "Will attempt to reconnect" but no actual reconnection code
- `kiosk-bridge.service.ts` ~line 127-129: logs CLOSED/CHANNEL_ERROR as warnings
- `admin.service.ts` ~line 115-150: health endpoint does NOT check realtime status

**Fix (optional):** Track last realtime event timestamp. If > 60s without any event, create an admin notification. Add `supabaseRealtimeConnected: boolean` to the health endpoint response.

---

## 17b. Integration Notes

### For Nexus Backend Developers

- **Prefix matching still needed** — Even though this kiosk stores full ref_codes, other future clients might not. Keep the prefix matching fallback in Nexus lookup methods.
- **OWWA quick queue uses OWWA series (not WALKIN_OWWA)** — Intentional. OWWA walk-ins are served in the same queue as OWWA appointments with priority 7.
- **kiosk writes `appt_status = 'ARRIVED'`** — On the `appointments` table after check-in. Nexus should expect this value and not treat it as an error.

### For AgencyHire Developers

1. The kiosk reads `appointments.ofw_fname`, `ofw_mname`, `ofw_lname` as top-level columns — not from `client_data` JSONB. If field names change, the kiosk breaks.

2. The kiosk reads `services.slug` to resolve queue series. If slugs change (e.g., `skilled-cv` → `cv-skilled`), the kiosk falls back to service_id resolution but may show wrong service labels.

3. The kiosk writes `appt_status = 'ARRIVED'` on the `appointments` table after check-in. If AgencyHire displays `appt_status`, it will show "ARRIVED" for checked-in clients.

---

## 18. Quick Reference — What Nexus Reads From Kiosk Entries

```sql
-- Get today's waiting queue for calling
SELECT * FROM kiosk_checkins
WHERE queue_date = $today_sgt
  AND status = 'WAITING'
ORDER BY priority ASC, queue_number ASC;

-- Get entries for queue display TV
SELECT * FROM kiosk_checkins
WHERE queue_date = $today_sgt
  AND status IN ('CALLED', 'PROCESSING', 'MISSED')
ORDER BY called_at DESC;

-- Find entry by ref_code (with prefix fallback)
SELECT * FROM kiosk_checkins
WHERE queue_date = $today_sgt
  AND (ref_code = $ref OR ref_code LIKE $ref_prefix || '%');

-- FRA entries grouped by transaction_ref
SELECT * FROM kiosk_checkins
WHERE queue_date = $today_sgt
  AND appointment_type = 'FRA'
ORDER BY queue_number ASC;

-- Today's stats
SELECT
  COUNT(*) AS checked_in,
  COUNT(*) FILTER (WHERE status IN ('WAITING', 'CALLED')) AS waiting,
  COUNT(*) FILTER (WHERE status NOT IN ('WAITING', 'CALLED', 'PENDING', 'FAILED', 'MISSED', 'DEFERRED')) AS served
FROM kiosk_checkins
WHERE queue_date = $today_sgt;
```

---

## 19. Thermal Ticket Format (80mm)

The kiosk prints tickets with this layout:

```
    ┌──────────────────────────┐
    │   MIGRANT WORKERS OFFICE │
    │        SINGAPORE         │
    │ ── ── ── ── ── ── ── ── │
    │                          │
    │         6001             │  ← 56pt bold
    │                          │
    │    Skilled Worker - CV    │  ← 11pt bold
    │    JUAN DELA CRUZ        │  ← 10pt semibold
    │ ── ── ── ── ── ── ── ── │
    │   01 Apr 2026  09:15     │  ← 9pt
    │                          │
    │ Please wait for your     │  ← 8pt
    │ number to be called.     │
    └──────────────────────────┘
```

The queue number on the ticket matches `display_number` in `kiosk_checkins` exactly.
