# Nexus Kiosk — Workflows

> Reference document for all user-facing workflows in the standalone check-in app.
> Covers both Receptionist Mode and Kiosk Mode operations.

---

## 1. Mode Selection

On first launch (or when mode is not remembered):

1. App shows **Mode Select** screen with two large buttons:
   - **Receptionist Mode** — Staff-operated, full feature set
   - **Kiosk Mode** — Self-service, locked interface
2. Optional "Remember this choice" checkbox
3. If remembered, app boots directly into selected mode on next launch

### Mode Switching
- From either mode: `Ctrl+Shift+S` → Settings overlay → change mode
- Mode change recreates the Electron window (kiosk mode → fullscreen + locked)

---

## 2. Settings Configuration

Accessible via `Ctrl+Shift+S` from any screen.

### Supabase Connection
- **Supabase URL** — Project URL (pre-filled from `.env` if available)
- **Anon Key** — Public key for reads
- **Service Key** — Secret key for writes (stored in electron-store, never in source)

### Printer Settings
- **Printer** — Dropdown of available system printers
- **Paper Width** — `58mm` (narrow thermal) or `80mm` (standard thermal)

### Connection Status
- `StatusBanner` component shows real-time Supabase connectivity
- Green = connected, Red = disconnected, auto-retries

---

## 3. Receptionist Mode — Full Workflow

### 3.1 Appointment Check-in (QR Scan)

This is the primary workflow — 80%+ of daily check-ins.

```
1. Screen shows: SearchPanel (left) + CheckinPanel (right)
2. Staff focuses the scan input field (auto-focused)
3. Client presents QR code from appointment confirmation
4. HID scanner reads QR → ref_code appears in input → Enter triggers lookup
5. System detects scan type:
   ├── 8-char alphanumeric → APPOINTMENT path
   ├── UUID (36 chars) → FRA path
   └── 20-30 chars → FRA path
6. APPOINTMENT path:
   a. Lookup: appointments WHERE ref_code = scanned value
   b. Validate:
      ├── Not found → "No appointment found"
      ├── Status cancelled/completed/no_show → "Appointment is [status]"
      └── Date ≠ today (SGT) → "Appointment is for [date], not today"
   c. Duplicate check: kiosk_checkins WHERE ref_code AND queue_date = today
      └── Found → "Already checked in as Q#[number]"
   d. Resolve service: services WHERE id = appointment.service_id → slug → series
   e. Generate: next_queue_number(today, series, startNumber)
   f. Format: displayNumber = formatQueueDisplay(number, series)
   g. Build name: [ofw_fname, ofw_mname, ofw_lname].filter(Boolean).join(' ')
   h. INSERT kiosk_checkins (status='WAITING', priority=3, call_count=0)
   i. Show success: large Q# + client name + service type
   j. Auto-print ticket if enabled
   k. Ready for next scan
```

### 3.2 FRA Check-in (QR Scan)

FRA registrations are agency-grouped. One scan checks in the entire group.

```
1. Staff scans agency's transaction reference QR code
2. App detects UUID or long alphanumeric → FRA path
3. Lookup: fra_registrations
   WHERE transaction_ref = scanned value
   AND appointment_date >= (today - 14 days)
   AND appointment_date <= today
   AND status != 'cancelled'
4. Validate:
   ├── Not found → "No FRA registration found"
   └── All completed → "FRA already completed"
5. Duplicate check for today
6. Generate: next_queue_number(today, 'FRA', 0)
7. Format: "A" + padStart(3, '0') → e.g., "A003"
8. INSERT kiosk_checkins (appointment_type='FRA', series='FRA', priority=3)
9. Fire-and-forget: UPDATE fra_registrations SET status='arrived', arrived_at=now()
10. Show success: large Q# + agency name
11. Auto-print ticket
```

**Key difference from regular:** FRA allows appointments up to 14 days old, not just today.

### 3.3 Walk-in Registration

For clients without appointments. Receptionist mode only.

```
1. Staff clicks "Walk-in" button (top right)
2. Modal opens with fields:
   - Service type dropdown (MDW CV, Skilled CV, OWWA, Direct Hire, FRA Registration)
   - First name (required)
   - Last name (required)
   - Middle name (optional)
   - Email (optional)
3. Submit:
   a. Map service to WALKIN_* series (e.g., MDW CV → WALKIN_REGULAR)
   b. Generate queue number from WALKIN_* series
   c. INSERT kiosk_checkins (appointment_type='WALKIN', priority=7)
   d. Show success + print ticket
```

**Walk-in priority (7) is lower than appointments (3)** — walk-ins are called after all appointment clients.

### 3.4 OWWA Quick Queue

One-click queue number for OWWA service, no client details needed.

```
1. Staff clicks "OWWA Quick" button
2. Generate: next_queue_number(today, 'OWWA', 9000)
3. INSERT kiosk_checkins (minimal fields, priority=3)
4. Show queue number + print ticket
```

### 3.5 Appointment Browsing

Staff can browse the day's appointments without scanning.

```
1. SearchPanel shows date picker (default: today) + search field
2. Browse: all appointments for selected date
3. Search: filter by name/email/phone
4. Click an appointment card → populates CheckinPanel
5. Staff reviews pre-filled fields, edits if needed
6. Click "Check In" → same check-in flow as QR scan
```

### 3.6 Last Check-in Display

After every successful check-in:
- Bottom banner shows: queue number + client name + service type
- Persists until next check-in or page change
- Provides visual confirmation for staff

### 3.7 Receptionist Stats

Header displays:
- **Checked in** — Total queue entries created today
- **Waiting** — Entries still in WAITING status
- **Served** — Entries past WAITING (excludes MISSED/DEFERRED)

---

## 4. Kiosk Mode — Self-Service Workflow

Kiosk mode is a single-input state machine. One scan or keyed reference is probed against all three source tables in parallel; whichever has a row wins. No type-select, no phone search, no method picker.

### State Machine
```
SPLASH → ENTRY → SUCCESS / ERROR
  ↑                  │
  └─── auto-reset ───┘
  (60s idle on ENTRY; success / error screens auto-reset on user action)
```

### 4.1 Splash Screen (SPLASH)
- Large "TAP TO START" call to action + MWO branding
- Touch anywhere → transitions to ENTRY
- HID scanner input is captured on ENTRY only (not SPLASH) — clients must tap first

### 4.2 Entry Screen (ENTRY)
- Single reference-code input field (auto-focused)
- HID scanner emits keystrokes → ENTER triggers submit
- On-screen alphanumeric keyboard for manual entry (touch-only kiosks)
  - Includes a `-` key so accreditation refs like `HSW2601-FM00CD` can be typed
- Helper text: `For Accreditation transaction, key in reference code (XXXXX-XXXXXXXX)`
- 60-second idle timeout → reset to SPLASH

### 4.3 Unified Router (`doCheckin`)

Every scan/keyed value runs through one router, regardless of shape:

```
1. Lookup in parallel:
   - appointments.ref_code             (via appointmentService.lookupByRefCode)
   - fra_registrations.transaction_ref (via fraService.lookupByRef, strict:false)
   - submissions.ref_code              (via submissionService.lookupByRefCode)

2. Count rows returned:
   - 0 matches → ERROR "No appointment, FRA registration, or
                       accreditation submission found for this code."
   - 2+ matches → ERROR "Ambiguous reference — please see the receptionist."
   - Exactly 1 → dispatch to the matching handler

3. Handler dispatch:
   - fra      → handleFra(fra, value)        (see 4.4)
   - appt     → handleAppointment(appt, value) (see 4.5)
   - submission → handleSubmission(submission)  (see 4.6)
```

**Why parallel/unified:** AgencyHire now generates 8-char alphanumeric `transaction_ref` values for FRA (e.g. `ABCD1234`). Shape-based routing would mis-classify these as appointment refs and miss the FRA registration. `detectScanType` in `lib/constants.ts` is still around as a shape hint but is **not** the router gate.

### 4.4 FRA Handler (`handleFra`)

```
1. FRA 12pm SGT cutoff (§5.7 in CLAUDE.md)
   └── Closed → ERROR FRA_CUTOFF_MESSAGE
   Cutoff is checked AFTER the FRA row resolves — appointment scans
   after noon never see the FRA cutoff message.

2. Block terminal statuses
   ├── status='cancelled' → ERROR "FRA registration is cancelled"
   └── status='moved'     → ERROR "Group has been split — use the new printed QR"

3. Analyse the whole transaction_ref group (`analyzeFraGroup`)
   ├── any deferredContracts → DEFERRED check-in
   │   • Insert kiosk_checkins(series='FRA', priority=3, remarks='DEFERRED')
   │   • Issue A-series queue number
   │   • Fire-and-forget: clear staff_notes on deferred contracts
   ├── any pickupContracts (status='or_issued') → PICKUP check-in
   │   • Insert kiosk_checkins(series='REGULAR', priority=3, remarks='PICKUP')
   │   • Issue 6000-series queue number
   │   • Ticket label: "PICKUP - FRA"
   └── otherwise → FRESH check-in
       • Re-apply date window: today through 14 days back, no future
       • Insert kiosk_checkins(series='FRA', priority=3)
       • Issue A-series queue number
       • Fire-and-forget: mark FRA arrived

4. Duplicate prevention (§5.9): if a non-deferred kiosk_checkin
   already exists for this transaction_ref today, return existing Q#.
```

### 4.5 Appointment Handler (`handleAppointment`)

```
1. Pickup check (pickupService.evaluateOfwPickup)
   ├── status ∈ {submitted, processed, or_issued} → PICKUP
   │   • Insert kiosk_checkins(series='REGULAR', priority=3, remarks='PICKUP')
   │   • Ticket label: "PICKUP - <SERVICE>" (e.g. PICKUP - DH)
   └── legacy DH past appointment + appt_status='ARRIVED' → PICKUP

2. Validate (validateAppointment, see CLAUDE.md §5.5)
   ├── status ∈ {cancelled, completed, no_show} → ERROR
   ├── appt_status='DEFERRED' AND date >= today-14d → ALLOW (deferred re-checkin)
   └── otherwise must be appointment_date === today SGT

3. Duplicate prevention (§5.9)

4. Resolve service → series mapping, build client name, generate queue number,
   insert kiosk_checkins(status='WAITING', priority=3, call_count=0)

5. Fire-and-forget arrival update:
   ├── appt_status='DEFERRED' → markArrivedFromDeferred (clears staff_notes)
   └── otherwise              → markArrived
```

### 4.6 Submission Handler (`handleSubmission`) — Accreditation

```
1. Blocked → ERROR "This accreditation submission cannot be checked in."

2. Pickup eligible (trans_status ∈ {submitted, processed, or_issued}, case-insensitive)
   • Insert kiosk_checkins(series='REGULAR', priority=3, remarks='PICKUP')
   • Ticket label: "PICKUP - ACCREDITATION"

3. First-visit eligible (trans_status='For Submission')
   • Insert kiosk_checkins(series='REGULAR', priority=3, no remarks)
   • Ticket label: "Accreditation"

4. Cross-day re-scan is allowed for pickup (§5.8) — the kiosk does NOT
   mutate the submissions row. A client whose OR is still being prepared
   can return on any later day until the OR is collected; same-day
   duplicates are caught by the (queue_date, ref_code, remarks='PICKUP') key.
```

### 4.7 Success Screen (SUCCESS)
- **Large queue number** in center (readable from 2 meters)
- Client name + service type (or `PICKUP - X`) below
- Auto-prints ticket immediately on entry to this screen
- Done button returns to SPLASH

### 4.8 Error Screen (ERROR)
- Error message in large text
- Common messages:
  - `"No appointment, FRA registration, or accreditation submission found for this code."`
  - `"Ambiguous reference — please see the receptionist."`
  - `"Already checked in as Q#<n>."`
  - `FRA_CUTOFF_MESSAGE` (post-12pm FRA scan)
- Retry button returns to ENTRY (preserves session)

### Kiosk Mode Restrictions
- No walk-in registration (no physical keyboard for name entry)
- No appointment browsing (too complex for self-service)
- No phone search (removed — reference codes only)
- No settings access without `Ctrl+Shift+S`
- Cannot navigate away from kiosk UI
- Fullscreen + locked window (no title bar, no menu)

---

## 5. Error States & Recovery

### Connection Errors
| Error | User Message | Recovery |
|-------|-------------|----------|
| No internet | "Cannot connect to server" | StatusBanner shows red; auto-retry |
| Supabase down | "Service temporarily unavailable" | Retry in 5 seconds |
| RPC timeout | "Failed to generate queue number" | Retry button |

### Validation Errors
| Error | User Message | Recovery |
|-------|-------------|----------|
| No match in any table | "No appointment, FRA registration, or accreditation submission found for this code." | Scan again or manual entry |
| Ambiguous reference | "Ambiguous reference — please see the receptionist." | Refer to receptionist (cannot self-resolve) |
| Wrong date | "Appointment is for [date], not today" | Show appointment details |
| Cancelled | "This appointment has been cancelled" | See receptionist |
| Already checked in | "Already checked in as Q#[number]" | Show existing queue number |
| FRA past cutoff | FRA_CUTOFF_MESSAGE (post-12pm SGT) | Return next working day 9am-12pm |
| FRA moved | "This FRA group has been split. Please use the new printed QR." | Receptionist re-prints |

### Hardware Errors
| Error | Behavior |
|-------|----------|
| Printer offline | Queue number still shows on screen; print silently fails |
| Scanner disconnected | Manual entry fallback available |

**Key principle:** Never lose the queue number. Even if printing fails, the screen must show the number and the database record must exist.

---

## 6. Crowd Management

The kiosk app's secondary goal is managing waiting area flow.

### Current Approach (With Receptionist)
1. Receptionist controls the pace of check-ins
2. Can verbally direct clients to waiting area
3. Can inform clients of approximate wait time
4. Can discourage walk-ins during busy periods
5. Can handle special cases (elderly, disabled, VIP)

### Design Guidance for Crowd Features
- **Waiting count display** — Show "X people ahead of you" on success screen
- **Estimated wait time** — Based on average processing time per service type
- **Capacity indicator** — Visual indicator when waiting area is near capacity
- **Walk-in messaging** — During peak times, kiosk could display "Walk-ins may experience extended wait times"
- **Appointment priority messaging** — "Clients with appointments are served first"

### Future Crowd Management Ideas
- Real-time dashboard showing waiting area occupancy
- SMS notification when queue number is approaching
- Pre-arrival check-in via web (client checks in from phone before arriving)
- Dynamic slot limiting based on current queue depth
- Integration with waiting area display (show current serving number + wait estimate)

---

## 7. Daily Operations Timeline

### Before Office Opens (7:45 AM)
1. Power on kiosk terminal
2. App loads in remembered mode (or select mode)
3. Verify Supabase connection (StatusBanner green)
4. Verify printer is ready (test print if needed)

### Office Hours (8:00 AM - 5:00 PM)
- **Receptionist Mode:** Staff processes check-ins as clients arrive
- **Kiosk Mode:** Clients self-service; staff monitors from separate screen

### Common Receptionist Actions
| Action | Frequency | Time per action |
|--------|-----------|----------------|
| QR scan check-in | ~50/day | 3-5 seconds |
| Walk-in registration | ~5-10/day | 15-30 seconds |
| FRA check-in | ~5-10/day | 5-10 seconds |
| OWWA quick queue | ~10-15/day | 2 seconds |

### End of Day
- No special shutdown needed
- App can remain running overnight
- Queue numbers reset daily (new date = new series)

---

## 8. Queue Status Transitions (Reference)

This app only writes the **first step**. All subsequent transitions happen in Nexus.

### What This App Writes
```
(nothing) → WAITING   (receptionist: complete entry with queue number)
(nothing) → PENDING   (kiosk: minimal entry, backend enriches later)
```

### What Nexus Does Next
```
WAITING → CALLED       (staff clicks "Call Next")
CALLED  → PROCESSING   (staff clicks "Serve")
CALLED  → MISSED       (staff clicks "Miss")
PROCESSING → SUBMITTED (staff clicks "Process")
SUBMITTED → PROCESSED  (automatic)
PROCESSED → OR_ISSUED  (cashier clicks "Issue OR")
```

### FRA-Specific (Nexus)
```
WAITING → CALLED       (cashier calls)
CALLED  → CONFIRMED    (cashier confirms submission)
CONFIRMED → PROCESSED  (admin processes)
PROCESSED → OR_ISSUED  (admin/cashier issues batch OR)
```

### Terminal States
`OR_ISSUED`, `MISSED`, `DEFERRED`, `RECEIVED` — no further transitions.
