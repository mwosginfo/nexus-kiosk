# DATABASE.md — Nexus Kiosk (Supabase Tables Reference)

> This app has **no local database**. All data flows through Supabase.
> This document defines the exact Supabase table schemas this app reads from and writes to.

---

## 1. Connection Architecture

```
┌── Nexus Kiosk ──────────────────────────────────────┐
│                                                      │
│  READS (anon key):                                  │
│    appointments, fra_registrations, services         │
│                                                      │
│  WRITES (service role key):                         │
│    kiosk_checkins (INSERT only)                     │
│    fra_registrations (UPDATE status + arrived_at)    │
│                                                      │
│  RPC (service role key):                            │
│    next_queue_number()                               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Two Supabase clients:**
| Client | Key | Created via |
|--------|-----|------------|
| Reader | Anon key (`VITE_SUPABASE_ANON_KEY`) | `getSupabase()` |
| Writer | Service role key (electron-store) | `getSupabaseWriter()` |

---

## 2. `appointments` — READ ONLY

Booking records created by AgencyHire (client-facing booking site) and Nexus staff.

### Columns Used by This App

| Column | Type | Nullable | Used For |
|--------|------|----------|----------|
| `id` | UUID | NO | Stored as `appointment_id` in kiosk_checkins |
| `ref_code` | TEXT | NO | Primary lookup key (QR scan value) |
| `service_id` | UUID | NO | Maps to service slug → queue series |
| `appointment_date` | DATE | NO | Validate appointment is for today (SGT) |
| `status` | TEXT | NO | CHECK: `pending`, `confirmed`, `completed`, `cancelled`, `no_show` |
| `ofw_fname` | TEXT | YES | First name (top-level column, NOT from client_data) |
| `ofw_lname` | TEXT | YES | Last name |
| `ofw_mname` | TEXT | YES | Middle name |
| `ofw_gender` | TEXT | YES | Gender |
| `ofw_visa` | TEXT | YES | Work permit type |
| `ofw_position` | TEXT | YES | Job position |
| `ofw_trans` | TEXT | YES | Transaction type (New Record, Change of Employer, etc.) |
| `client_email` | TEXT | YES | Client email |
| `client_contact` | TEXT | YES | Client phone number |
| `p_name` | TEXT | YES | Employer/principal name |
| `client_data` | JSONB | YES | **LEGACY — do not read OFW fields from here** |

### Queries This App Makes

```sql
-- Lookup by ref_code (QR scan)
SELECT * FROM appointments WHERE ref_code = $1;

-- Browse by date (receptionist search panel)
SELECT * FROM appointments
WHERE appointment_date >= $start AND appointment_date <= $end
ORDER BY created_at DESC;

-- Search by phone
SELECT * FROM appointments
WHERE client_contact ILIKE $1 OR client_data->>'mobile_no' ILIKE $1;

-- Search by name/email
SELECT * FROM appointments
WHERE ofw_fname ILIKE $1 OR ofw_lname ILIKE $1 OR client_email ILIKE $1;
```

### Validation Rules
| Check | Condition | Error |
|-------|-----------|-------|
| Exists | `ref_code` returns a row | "No appointment found" |
| Status valid | status IN (`pending`, `confirmed`) | "Appointment is [status]" |
| Date match | `appointment_date` = today SGT | "Appointment is for [date]" |

---

## 3. `fra_registrations` — READ + LIMITED WRITE

Agency FRA worker registration records.

### Columns Used by This App

| Column | Type | Nullable | Used For |
|--------|------|----------|----------|
| `id` | UUID | NO | Row identifier |
| `transaction_ref` | TEXT | NO | Primary lookup key (UUID or long alphanumeric) |
| `pra` | TEXT | YES | PRA agency name |
| `fra` | TEXT | YES | FRA agency name |
| `status` | TEXT | NO | CHECK: `pending`, `arrived`, `completed`, `cancelled` |
| `appointment_date` | DATE | YES | Date of FRA appointment |
| `arrived_at` | TIMESTAMPTZ | YES | Written by this app on check-in |
| `staff_notes` | TEXT | YES | Nexus tags: `[NEXUS:DEFERRED]`, `[NEXUS:REMOVED]` |

### Queries This App Makes

```sql
-- Lookup by transaction_ref (FRA QR scan)
SELECT * FROM fra_registrations
WHERE transaction_ref = $1
  AND appointment_date >= (CURRENT_DATE - INTERVAL '14 days')
  AND appointment_date <= CURRENT_DATE
  AND status != 'cancelled';
```

### Write Operations

```sql
-- Mark as arrived (fire-and-forget, non-fatal on error)
UPDATE fra_registrations
SET status = 'arrived', arrived_at = NOW()
WHERE id = $1;
```

### Validation Rules
| Check | Condition | Error |
|-------|-----------|-------|
| Exists | `transaction_ref` returns rows within 14-day window | "No FRA registration found" |
| Status | status IN (`pending`, `arrived`) | "FRA already completed" |
| Not cancelled | status != `cancelled` | Excluded from results |

---

## 4. `services` — READ ONLY

Service type definitions. Used to map `appointment.service_id` to a queue series.

### Columns Used by This App

| Column | Type | Used For |
|--------|------|----------|
| `id` | UUID | FK from appointments.service_id |
| `slug` | TEXT | Maps to queue series + service type |

### Known Mappings (Hardcoded Fallbacks)

| `service_id` | Slug | Queue Series | Service Type |
|---|---|---|---|
| `30c55940-083c-434a-8212-e810f2fa37b2` | `skilled-cv` | `REGULAR` | `SKILLED_CV` |
| `cc50f069-1dc6-48ac-9e04-dbaf2a28b839` | `mdw-cv` | `REGULAR` | `MDW_CV` |
| `ff4eeaf1-0009-4664-b9d8-6ea48de0f745` | `dh` | `REGULAR` | `DH` |
| `23470e2d-397e-4a24-b3ee-f55ed3fec65c` | `owwa` | `OWWA` | `OWWA` |
| `7b9257b9-b2b6-404c-b277-c585ef27ec34` | `fra-registration` | `FRA` | `FRA_REGISTRATION` |

**Fallback:** If a service_id is unknown, default to `REGULAR` series / `DH` service type. Never crash on unknown service.

---

## 5. `kiosk_checkins` — WRITE (INSERT ONLY)

**This is the primary output of this app.** Every successful check-in creates exactly one row here.

### Full Column Specification

| Column | Type | Required | Value | Notes |
|--------|------|----------|-------|-------|
| `ref_code` | TEXT | YES | Full QR scan value | 8-char for appointments, 20-36 for FRA. **Never truncate.** |
| `transaction_ref` | TEXT | YES | Same as ref_code (appointments) or transaction_ref (FRA) | **Store FULL value.** |
| `appointment_type` | TEXT | YES | `'APPOINTMENT'`, `'FRA'`, or `'WALKIN'` | CHECK constraint enforced |
| `queue_number` | INT | YES | From `next_queue_number()` RPC | **Never generate locally** |
| `display_number` | TEXT | YES | Formatted per series | `"6001"`, `"A001"`, `"W601"` |
| `queue_series` | TEXT | YES | `'REGULAR'`, `'OWWA'`, `'FRA'`, `'WALKIN_REGULAR'`, `'WALKIN_OWWA'`, `'WALKIN_FRA'` | Maps from service slug |
| `service_type` | TEXT | YES | `'SKILLED_CV'`, `'MDW_CV'`, `'DH'`, `'FRA_REGISTRATION'`, `'OWWA'`, `'ACCREDITATION'` | Maps from service slug |
| `status` | TEXT | YES | `'WAITING'` or `'PENDING'` | Receptionist=WAITING, Kiosk=PENDING if unresolved |
| `client_name` | TEXT | YES | Full name from appointment | `[fname, mname, lname].filter(Boolean).join(' ')` |
| `client_email` | TEXT | nullable | From appointment | NULL for FRA and some walk-ins |
| `appointment_id` | UUID | nullable | Appointment UUID | NULL for FRA and walk-ins |
| `queue_date` | TEXT | YES | Today in SGT: `YYYY-MM-DD` | **Must be SGT, not UTC** |
| `priority` | SMALLINT | YES | `3` (appointments/FRA) or `7` (walk-ins) | Determines call order |
| `call_count` | SMALLINT | YES | `0` | Always initialize to 0 |
| `created_at` | TIMESTAMPTZ | auto | `now()` | Set by Supabase default |

### Columns This App Must NOT Write

These are managed by the Nexus backend only:

`assigned_to`, `counter_number`, `called_at`, `completed_at`, `remarks`, `deferral_reason`, `error_message`, `processed_at`, `last_called_at`

### Unique Constraint

`(queue_date, queue_number, queue_series)` — prevents duplicate queue numbers per day per series.

If this constraint is violated, it means `next_queue_number()` RPC had a concurrency failure — retry the entire check-in.

---

## 6. `next_queue_number()` — Supabase RPC

Atomic queue number generator with advisory lock for concurrency safety.

### Signature

```sql
next_queue_number(
  p_queue_date   TEXT,     -- "2026-03-31" (SGT)
  p_queue_series TEXT,     -- "REGULAR", "FRA", "OWWA", "WALKIN_REGULAR", etc.
  p_start_number INTEGER   -- Starting number for this series
) RETURNS INTEGER
```

### Behavior
1. Acquires `pg_advisory_xact_lock` keyed to (date, series)
2. Queries MAX(queue_number) from kiosk_checkins for the given date + series
3. Returns `MAX + 1` or `start_number + 1` if no entries exist today
4. Lock released on transaction commit

### Usage Pattern

```typescript
const { data: queueNumber, error } = await supabaseWriter.rpc('next_queue_number', {
  p_queue_date: todaySGT(),
  p_queue_series: series,
  p_start_number: getStartNumber(series),
});

if (error || queueNumber === null) {
  throw new Error('Failed to generate queue number');
}
```

### Start Numbers

| Series | `p_start_number` |
|--------|-----------------|
| `REGULAR` | `6000` |
| `OWWA` | `9000` |
| `FRA` | `0` |
| `WALKIN_REGULAR` | `600` |
| `WALKIN_OWWA` | `900` |
| `WALKIN_FRA` | `0` |

---

## 7. Display Number Formatting

```typescript
function formatQueueDisplay(queueNumber: number, series: string): string {
  switch (series) {
    case 'FRA':
      return `A${String(queueNumber).padStart(3, '0')}`;
    case 'WALKIN_FRA':
      return `WA${String(queueNumber).padStart(2, '0')}`;
    case 'WALKIN_REGULAR':
    case 'WALKIN_OWWA':
      return `W${queueNumber}`;
    default:
      return String(queueNumber);
  }
}
```

---

## 8. Data Flow Summary

```
Client arrives with QR code
         │
         ▼
┌── This App ──────────────────────────────────────┐
│  1. READ appointments (by ref_code)              │
│  2. READ services (by service_id → slug)         │
│  3. READ kiosk_checkins (duplicate check)        │
│  4. RPC next_queue_number()                      │
│  5. INSERT kiosk_checkins (WAITING/PENDING)       │
│  6. UPDATE fra_registrations (arrived) [FRA only] │
└──────────────────────────────────────────────────┘
         │
         ▼  (Supabase real-time / polling)
         │
┌── Nexus Backend ─────────────────────────────────┐
│  7. Kiosk Bridge detects new entry               │
│  8. Queue system shows entry on Live Window      │
│  9. Staff calls → processes → issues OR          │
└──────────────────────────────────────────────────┘
```

---

## 9. What NOT to Do

- Do not INSERT to any table other than `kiosk_checkins` and `fra_registrations` (update only)
- Do not DELETE or UPDATE `kiosk_checkins` rows — only INSERT
- Do not generate queue numbers locally — always use the RPC
- Do not read OFW fields from `client_data` JSONB — use top-level columns
- Do not write to backend-only columns (`assigned_to`, `counter_number`, etc.)
- Do not store the service role key in source code — it belongs in electron-store
- Do not use UTC for `queue_date` — always SGT
- Do not truncate `ref_code` or `transaction_ref` — store full values
