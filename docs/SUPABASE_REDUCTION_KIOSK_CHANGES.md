# Kiosk Changes for Supabase-Reduction Workflow

**Status:** Draft for dev review
**Scope:** `mwosginfo/nexus-kiosk` only
**Branch:** `claude/reduce-supabase-dependency-DKw3Z`
**Companion doc:** `mwosginfo/nexus` → `docs/SUPABASE_REDUCTION_PLAN.md`

---

## 1. Why the kiosk needs to change

The original Supabase-reduction plan declared kiosk “out of scope.” On a second pass that's not quite right — the new state machines in Nexus (`CONFIRMED → ARRIVED → DEFERRED → SUBMITTED → OR_ISSUED → RELEASED`) reference status values on `appointments`, `fra_registrations`, and `submissions` that the kiosk's scan validation does **not** currently recognise. If left unchanged, the kiosk will reject re-scans that should succeed (e.g. an FRA group returning for the deferred half, an accreditation client returning for pickup, a DH client returning after a previous deferral).

The kiosk remains the **only writer** to `kiosk_checkins` and the only consumer of `appointments`/`fra_registrations`/`submissions` from the office side. Updating its validation table is cheap and unblocks the rest of the work.

## 2. Current reality (audited from this repo)

### 2.1 `appointments.status` (used by `src/services/appointment.service.ts`, `src/pages/receptionist/CheckinPanel.tsx`)

| Value | Accepted today? | Comes from |
|---|---|---|
| `pending` | yes (lookup) | rare — only if agencyhire ever writes pending; today it writes `confirmed` |
| `confirmed` | yes | agencyhire booking insert (`/app/api/appointments/route.ts:104`) |
| `cancelled` | hard block (`CheckinPanel.tsx:97-100`) | manual / admin |
| `no_show` | hard block | end-of-day sweep |
| `completed` | blocked unless DH pickup branch (`CheckinPanel.tsx:102-104`) | post-release |
| `deferred` | **not recognised on `status` column** | (kiosk only reads `appt_status='DEFERRED'`) |
| `submitted` | **not recognised** | new |
| `or_issued` | **not recognised** | new |

### 2.2 `appointments.appt_status` (separate column, kiosk uses this for arrival/defer state)

| Value | Today |
|---|---|
| `ARRIVED` | set by kiosk after successful check-in (`appointment.service.ts` markArrived) |
| `DEFERRED` | recognised on re-scan for DH (`CheckinPanel.tsx:149`) within 14-day window |
| (null / other) | normal pre-arrival state |

### 2.3 `fra_registrations.status` (`src/services/fra.service.ts`)

| Value | Today |
|---|---|
| `pending` | initial insert from agencyhire (`/pages/api/submit.js:546,628`) |
| `arrived` | set by kiosk on check-in; `staff_notes != null` then doubles as **deferred** (a hack) |
| `completed` | pickup-eligible (cashier/processor flips it after release) |
| `cancelled` | hard block |
| `confirmed`, `submitted`, `or_issued`, `deferred`, `moved` | **none of these exist today** |

### 2.4 `submissions.status` (`backfill-submissions.mjs:96`)

| Value | Today |
|---|---|
| `pending` | initial value |
| `trans_status='Received'` | sheet sync default |
| `for_submission`, `submitted`, `or_issued`, `confirmed`, `released` | **none used by kiosk today** |

## 3. Required changes

### 3.1 Expand the accept-list on appointment scan

File: `src/services/appointment.service.ts` (`lookupByRefCode`, `validateAppointment`) and `src/pages/receptionist/CheckinPanel.tsx` (`handleCheckin`).

| `appointments.status` value | New behaviour |
|---|---|
| `pending`, `confirmed` | accept (unchanged) |
| `submitted` | **accept** — DH/CV client returning to pick up the OR. Route as pickup-mode (similar to current `completed` + DH branch). |
| `or_issued` | **accept** — client returning to collect documents. Route as pickup-mode; kiosk inserts `kiosk_checkins.remarks='PICKUP'`. |
| `released` | **block** — already done. |
| `cancelled`, `no_show` | block (unchanged) |
| `completed` | keep DH pickup branch; also accept generally with `remarks='PICKUP'` to align with `submitted`/`or_issued`. |

Keep `appt_status='DEFERRED'` behaviour as today (re-scan within 14 days).

### 3.2 Expand the accept-list on FRA scan

File: `src/services/fra.service.ts` (`lookupByRef`, `analyzeFraGroup`, `markArrived`) and `src/pages/receptionist/CheckinPanel.tsx`.

| `fra_registrations.status` value | New behaviour |
|---|---|
| `pending` | accept (unchanged) — initial agencyhire state. |
| `confirmed` | accept (forward-compat if agencyhire migrates from `pending` to `confirmed`). |
| `arrived` (no `staff_notes`) | accept — same-day re-call. (unchanged) |
| `arrived` + `staff_notes != null` | treat as deferred (current hack, **deprecated** — see 3.3). |
| `deferred` (new value) | accept — routes through deferred branch within 14 days. |
| `submitted` (new) | accept as pickup-mode (client returning for OR / documents). |
| `or_issued` (new) | accept as pickup-mode. |
| `completed` | accept as pickup (unchanged). |
| `moved` (new — set when worker rows are split out to a new transaction_ref) | **block** with a friendly "this group has been split, use the new QR" message. Look up the new ref via a helper that queries `fra_registrations WHERE transaction_ref` excluded only this ref. |
| `cancelled` | block (unchanged). |

### 3.3 Replace the `arrived + staff_notes` deferred hack

Today a deferred FRA is encoded as `status='arrived' AND staff_notes != null`. The new model uses an explicit `status='deferred'` value on `fra_registrations`. The kiosk should:

1. On the next read, **prefer** `status='deferred'` when present.
2. **Fall back** to the `arrived+staff_notes` hack only if Nexus hasn't migrated the rows yet (transitional code, removable after Nexus rollout week 5).
3. Stop writing `staff_notes` itself in `markArrived` deferral paths — Nexus owns the deferral signal.

### 3.4 Accreditation / submissions scan support (NEW capability)

The kiosk currently doesn't accept a submissions QR. Add a new scan path:

- New service `src/services/submissions.service.ts`:
  - `lookupByRefCode(refCode)` → `SELECT * FROM submissions WHERE ref_code = ?`
  - `markArrived(refCode)` → `UPDATE submissions SET status='arrived' WHERE ref_code = ? AND status IN ('pending','for_submission')`
- `detectScanType(scanned)` (`SearchPanel.tsx`) gains a SUBMISSION branch (e.g. `S` prefix or distinct length).
- `CheckinPanel.tsx` adds an accreditation case that calls `submissionsService` and inserts `kiosk_checkins` with `appointment_type='ACCREDITATION'`, `service_type='ACCREDITATION'`.
- Accept-list on `submissions.status`:

| Value | Behaviour |
|---|---|
| `pending`, `for_submission`, `confirmed` | accept → first visit (`arrived`) |
| `submitted`, `or_issued` | accept → pickup-mode (second visit) |
| `released`, `cancelled` | block |

### 3.5 Pickup-mode unified semantics

When any of the three source tables resolves into a pickup case (DH `completed`, FRA `completed/submitted/or_issued`, submissions `submitted/or_issued`), the kiosk should:

- Insert `kiosk_checkins` with `remarks='PICKUP'`, `priority=2` (lower than normal arrivals so cashier/release counter can pick them up off a Pickup queue), `queue_series='REGULAR'` (not the original FRA `A`-series).
- NOT update the source-table status. Nexus owns that transition on actual release.

### 3.6 Duplicate guard

Current `checkDuplicate` (`queue.service.ts:85`) blocks same-day rescans except for `DEFERRED/FAILED`. Extend the not-in clause to also allow re-entry when:

- The previous row is `WAITING/CALLED/PROCESSING` AND `remarks IS NULL` AND the user is now scanning for pickup (status implies pickup) — because that's the legitimate second visit.

Concretely:
```ts
// pseudocode
if (sourceStatus in {submitted, or_issued, completed} && existing.remarks !== 'PICKUP') {
  return ALLOW; // second-visit pickup
}
```

## 4. Schema migrations (Supabase) that this depends on

Apply these in the `nexus` repo's `packages/database/sql/supabase/` (not in kiosk repo), but they MUST land before kiosk rollout:

1. **`fra_registrations`**: extend `status` enum/check constraint to include `'confirmed'`, `'deferred'`, `'submitted'`, `'or_issued'`, `'moved'`. (Today only `pending`/`arrived`/`completed`/`cancelled` are enforced.)
2. **`submissions`**: extend `status` to include `'arrived'`, `'submitted'`, `'or_issued'`, `'released'` if not present.
3. **`appointments`**: extend `status` to include `'submitted'`, `'or_issued'`, `'released'` for non-FRA services.
4. Optional: add a uniqueness index on `fra_registrations.transaction_ref` (today it groups, not unique) — needed for the FRA split-mint to be safe.

## 5. Files to change

| File | Change |
|---|---|
| `src/services/appointment.service.ts` | Extend `lookupByRefCode`/`validateAppointment` accept-list; route `submitted/or_issued/completed` to pickup-mode. |
| `src/services/fra.service.ts` | Extend `analyzeFraGroup` to recognise `deferred`/`submitted`/`or_issued`/`moved`; replace `staff_notes` deferral fallback with explicit `status='deferred'`. |
| `src/services/submissions.service.ts` | NEW. lookupByRefCode + markArrived. |
| `src/services/queue.service.ts` | `checkDuplicate` accept-list update. |
| `src/pages/receptionist/SearchPanel.tsx` | `detectScanType` adds SUBMISSION branch. |
| `src/pages/receptionist/CheckinPanel.tsx` | New accreditation route; expanded validations. |
| `src/pages/kiosk/KioskLayout.tsx` | Self-service path mirrors the new pickup-mode for appointments and FRA. |
| `supabase/kiosk_checkins.sql` | No structural change — but verify `remarks` allows `'PICKUP'` (it does). |

## 6. Test plan

### 6.1 Receptionist mode
- Scan an `appointments.status='confirmed'` CV → today’s queue (regression).
- Scan an `appointments.status='submitted'` DH → pickup queue (NEW).
- Scan an `appointments.appt_status='DEFERRED'` within 14 days → deferred re-entry (regression).
- Scan an `fra_registrations.status='deferred'` group → deferred re-entry.
- Scan a group where one ref has `moved`, the rest are `deferred` → deferred path is correct; the moved row prompts "use new QR".
- Scan a `submissions.status='for_submission'` accreditation → first-visit queue (NEW).
- Scan a `submissions.status='or_issued'` accreditation → pickup queue (NEW).

### 6.2 Self-service kiosk
- Mirror above for appointment and FRA scans (no submissions on self-service yet — confirm with product).

### 6.3 Edge
- Duplicate same-day scan after pickup completes → allowed (new behaviour); after release → blocked.
- Network failure during `markArrived` → fire-and-forget log, check-in row still created (existing behaviour preserved).

## 7. Rollout sequence (coordinated with Nexus)

1. **D0 — Supabase enum/check-constraint migrations** (§4) applied by Nexus dev.
2. **D0+1 — Kiosk PR merged behind a feature flag** `KIOSK_EXTENDED_STATUSES=false`. Old logic still active.
3. **D0+2 — Nexus rolls out pending-table flow** (per Nexus doc rollout step 2).
4. **D0+5 — Flip kiosk flag to true in staging**, run §6 manual scripts.
5. **D0+10 — Flip kiosk flag to true in production.**
6. **D0+40 — Remove `staff_notes` deferral fallback** (per §3.3).

## 8. Open items for product / dev to confirm

1. Does agencyhire migrate from writing `fra_registrations.status='pending'` to `'confirmed'`? If yes, this should land before the kiosk rollout so a single value is canonical. If not, keep accepting both.
2. Will self-service kiosk handle accreditation scans, or is that receptionist-only? (Doc above assumes receptionist-only for now.)
3. What's the QR encoding for a submissions ref_code? Is it distinguishable from an appointments ref_code by length/prefix? If not, `detectScanType` will need a server lookup heuristic.
4. For the `moved` status redirect message — should the kiosk fetch the new transaction_ref and offer to re-scan automatically, or just tell the receptionist the client needs the new printed QR?

---

*Paired with `mwosginfo/nexus` → `docs/SUPABASE_REDUCTION_PLAN.md`. Both docs live on branch `claude/reduce-supabase-dependency-DKw3Z` in their respective repos.*
