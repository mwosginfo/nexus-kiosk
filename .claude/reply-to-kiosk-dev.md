# Reply: NEXUS_INTEGRATION Review — Required Changes

> From: Nexus Backend Team
> To: Standalone Check-in App Developer
> Re: NEXUS_INTEGRATION(1).md review
> Date: 2026-04-01

Thanks for the thorough integration doc. We've reviewed it against the live Nexus codebase and made several fixes on our side. Below is everything you need to update on the kiosk to stay in sync.

---

## 1. Bugs You Reported — Status

| Bug | Your Report | Our Action |
|-----|------------|------------|
| **BUG-1:** call_count not reset on reactivation | 3 locations identified | **FIXED.** All 3 reactivation paths now set `call_count: 0, last_called_at: null`. |
| **BUG-2:** Dual kiosk listeners race condition | subscribeToKioskCheckins duplicates KioskBridgeService | **FIXED.** Removed `subscribeToKioskCheckins()` and `processPendingKioskCheckins()` from `supabase.service.ts`. `KioskBridgeService` is now the single PENDING processor. |
| **BUG-3:** Service mapping duplication | 4+ locations with divergent values | **Partially fixed.** `kiosk-bridge.service.ts` now imports `QUEUE_START_NUMBERS` from `@nexus/types` instead of hardcoding. The OWWA start number was `8001` in kiosk-bridge — now correctly `9001`. Other mapping duplications remain (low priority). |
| **BUG-4:** No realtime health monitoring | No reconnection logic, no health endpoint status | **Acknowledged.** Low priority — the 5s polling fallback mitigates. Will address in a future pass. |

**No action required from you on these.** Just be aware the Nexus side is now fixed.

---

## 2. REQUIRED CHANGE: Start Numbers

We corrected `QUEUE_START_NUMBERS` to match your doc. **Verify your kiosk uses these exact values:**

| Series | `p_start_number` | First Number Returned |
|--------|------------------|-----------------------|
| `REGULAR` | **6001** | 6001 |
| `OWWA` | **9001** | 9001 |
| `FRA` | **1** | 1 |
| `WALKIN_REGULAR` | **601** | 601 |

Your doc already lists these correctly. If your kiosk code matches the doc, **no change needed.** If your code was aligned to the old Nexus values (6000, 9000, 0, 600), update to the doc values.

---

## 3. REQUIRED CHANGE: OWWA Walk-ins Use Main OWWA Series

**Operations decision:** OWWA walk-ins are served in the same queue as OWWA appointments. There is no separate walk-in queue for OWWA.

**Your current behavior (Section 11):**
```
OWWA quick queue:
  queue_series = 'OWWA'     ← CORRECT
  priority = 7              ← CORRECT
```

This is already correct per your doc. **No change needed** if your code matches.

**What changed on Nexus side:**
- `addWalkIn(serviceType='OWWA')` now writes `queue_series: 'OWWA'` (was `WALKIN_OWWA`)
- `assignOwwaQueueNumber()` (new feature — CV staff can push a client to the OWWA queue) writes `queue_series: 'OWWA'`
- `getWaitingQueue('OWWA')` includes both `OWWA` and `WALKIN_OWWA` for backward compatibility, so any existing `WALKIN_OWWA` entries are still picked up

**For your kiosk:** Continue using `queue_series: 'OWWA'` for OWWA quick queue. Do NOT use `WALKIN_OWWA`.

---

## 4. REQUIRED CHANGE: `service_type` Value for OWWA

**Your doc (Section 11):**
```
service_type = 'OWWA'
```

**Issue:** The Prisma `ServiceType` enum does NOT include `'OWWA'`. The value works in Supabase (free TEXT column, no constraint) and OWWA is queue-only (no local transaction created). But if Nexus ever needs to map this value through `mapServiceType()`, it will throw.

**Required change:** Update your OWWA quick queue to write:
```
service_type = 'DH'     ← Use 'DH' as the placeholder for OWWA
```

This matches what the Nexus check-in page writes for OWWA walk-ins and what the kiosk integration doc's Section 2 slug mapping table says (`owwa` → ServiceType `OWWA` should be `DH`).

**Alternatively**, if you prefer keeping `'OWWA'` as the service_type for clarity, add this to your doc as an explicit contract: "Nexus must never call mapServiceType() on OWWA queue entries." We can live with either approach, but `'DH'` is safer.

---

## 5. NEW FEATURE: OWWA Auto-Serve (5-Second Timer)

Your doc's status lifecycle (Section 6) shows:
```
OWWA: WAITING → CALLED → auto(5s) → RECEIVED
```

This is now implemented on the Nexus side:
- When OWWA staff clicks "Call Next", a 5-second frontend countdown starts
- After 5 seconds, the entry auto-transitions to `RECEIVED` (served)
- Staff can click "Miss" or "Defer" during the countdown to cancel auto-serve
- The "Served" button is removed from the OWWA page

**RECEIVED entries now persist on the queue display TV** in solid green (#059669). Previously they dropped off immediately.

**No kiosk change needed.** The kiosk only writes WAITING entries. The auto-serve is purely a Nexus frontend feature.

---

## 6. NEW FEATURE: "Give OWWA Queue No." from CV Page

Nexus CV processors can now assign an OWWA queue number to a client being served. This creates a new `kiosk_checkins` entry:

```
ref_code:         'OWWA-{original_ref_code}'
appointment_type: 'WALKIN'
queue_series:     'OWWA'
service_type:     'DH'
priority:         7
status:           'WAITING'
```

**No kiosk change needed.** This entry appears in the OWWA queue alongside kiosk-created entries. The kiosk doesn't interact with it.

---

## 7. NEW FEATURE: Queue Priority & 3-Call Auto-Miss

These features are now live on Nexus:

**Priority ordering:** `getWaitingQueue()` now orders by `priority ASC, queue_number ASC`. Appointments (priority 3) are called before walk-ins (priority 7).

**3-call auto-miss:** `callNext()` loops through WAITING entries. Any entry with `call_count > 3` is auto-marked MISSED with an audit log entry. The loop continues to the next entry.

**Your kiosk correctly sets:**
- `priority: 3` for appointments/FRA ✓
- `priority: 7` for walk-ins ✓
- `call_count: 0` on insert ✓

**No kiosk change needed.**

---

## 8. NEW FEATURE: Queue Display Shows RECEIVED Entries

The queue display TV (`/queue-display` and the AWS S3 version) now queries:
```sql
status IN ('CALLED', 'PROCESSING', 'MISSED', 'RECEIVED')
```

Previously it was only `CALLED, PROCESSING, MISSED`. RECEIVED entries (OWWA auto-serve) now show in solid green on the display.

**If your kiosk has its own display component**, update the query to include `RECEIVED`.

---

## 9. Supabase RLS — Action Required on Your Side

**`fra_registrations` has no RLS.** Your doc (Section 14) correctly documents this. Anyone with the anon key can read all FRA registrations.

**Recommended action:** Enable RLS on `fra_registrations` in the Supabase dashboard:

```sql
ALTER TABLE public.fra_registrations ENABLE ROW LEVEL SECURITY;

-- Service role (kiosk + Nexus backend) keeps full access automatically
-- No anon policy needed — anon should not read fra_registrations
```

After enabling, the kiosk will still work (service role key bypasses RLS). But anon access will be blocked.

**Also update the RLS policy for `kiosk_checkins`** to include RECEIVED:

```sql
DROP POLICY IF EXISTS "queue_display_read" ON public.kiosk_checkins;
CREATE POLICY "queue_display_read" ON public.kiosk_checkins
FOR SELECT USING (
  status IN ('CALLED', 'PROCESSING', 'MISSED', 'WAITING', 'RECEIVED')
  AND queue_date = (CURRENT_DATE AT TIME ZONE 'Asia/Singapore')::text
);
```

---

## 10. Doc Corrections — Minor

### Section 2 — Slug → Queue Series Table
Row for `owwa` says `Service Type: OWWA`. Should be `DH` (OWWA isn't a Prisma ServiceType).

### Section 12 — Display Number Formatting
Missing cases for `WALKIN_OWWA` → `W{number}` and `WALKIN_FRA` → `WA{padStart(2,'0')}`. These exist in Nexus's `formatQueueDisplay()`. The kiosk doesn't use these series, but document them for completeness:

```typescript
case 'WALKIN_OWWA': return `W${queueNumber}`;      // W901, W902
case 'WALKIN_FRA':  return `WA${String(queueNumber).padStart(2, '0')}`;  // WA01, WA02
```

### Section 6 — Status Lifecycle
Add to the OWWA line:
```
OWWA: WAITING → CALLED → auto(5s) → RECEIVED (terminal, persists on display in green)
```

### Section 17 — Bug Reports
Update:
- BUG-1: **RESOLVED** (2026-04-01) — call_count: 0 added to all 3 reactivation paths
- BUG-2: **RESOLVED** (2026-04-01) — dual listener removed from supabase.service.ts
- BUG-3: **Partially resolved** — kiosk-bridge now uses shared QUEUE_START_NUMBERS

---

## Summary — What You Need to Do

| # | Change | Priority | Effort |
|---|--------|----------|--------|
| 1 | Verify start numbers match (6001, 9001, 1, 601) | HIGH | Check only |
| 2 | OWWA quick queue: keep `queue_series: 'OWWA'` (confirmed correct) | — | No change |
| 3 | OWWA quick queue: change `service_type` from `'OWWA'` to `'DH'` | MEDIUM | 1 line |
| 4 | Enable RLS on `fra_registrations` in Supabase | HIGH | 2 SQL lines |
| 5 | Update `kiosk_checkins` RLS to include RECEIVED status | LOW | 1 SQL statement |
| 6 | Update doc Sections 2, 6, 12, 17 with corrections above | LOW | Doc edits |

Items 1 and 2 are likely already correct. Item 3 is the only code change. Items 4-5 are Supabase admin actions. Item 6 is documentation.

---

## Questions for You

1. **Ref code storage:** Your doc says full ref_code is always stored (never truncated). We've confirmed this from live data — all recent kiosk entries have full refs. Can you confirm there are no edge cases (very long FRA refs, encoding issues) where truncation could still occur?

2. **OWWA quick queue client_name:** Your doc says `client_name = ''` (empty string) for OWWA quick queue. Is this intentional? The queue display shows an empty name for these entries. Should we show "OWWA Walk-in" instead?

3. **`appt_status = 'ARRIVED'`:** Your kiosk writes this on the appointments table. Nexus currently ignores it (we validate against `status`, not `appt_status`). Is the AgencyHire booking system reading `appt_status`? If not, we can skip this write to reduce Supabase operations.

4. **Rate limiting:** Your client-side 10/60s limit is a good UX guard but not a security control. Would you be open to us adding a Postgres-level threshold check in the `next_queue_number()` RPC (e.g., refuse to return > 500 numbers per series per day)?
