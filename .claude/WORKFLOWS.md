# Nexus Kiosk Workflows

> Reference document for the standalone check-in kiosk. Covers kiosk-specific workflows and the broader Nexus staff workflows for context.
>
> **This kiosk is a bridge:** It reads appointments from Supabase and provides queue numbers via the Nexus backend (LAN or Supabase bridge).

---

## 0. Kiosk Check-in Flow (Self-Service Mode)

### Screen Flow
```
SPLASH → TYPE_SELECT → SEARCH_METHOD → MANUAL_SEARCH → SUCCESS / ERROR
                                    ↑ (QR scan auto-triggers from any screen)
```

### Self-Service Kiosk Mode
1. Client approaches kiosk (splash screen with "Tap to Start")
2. **Type Select:** Regular Appointment or FRA Registration
3. **Search Method:** Scan QR Code, Enter Phone Number, or Enter Reference Code
4. **QR Scan (fastest path):** Client scans appointment QR → auto-detected as Regular or FRA
5. System looks up appointment in Supabase by `ref_code`
6. **Queue assignment:** Via LAN API or Supabase bridge (see connectivity modes below)
7. **Success screen:** Large queue number display + auto-print thermal ticket
8. 60-second idle timer auto-returns to splash

### Receptionist Mode (Staff-Assisted)
1. Split screen: Search Panel (left) + Check-in Panel (right)
2. Staff searches by ref_code, phone, or scans QR
3. Appointment card displayed → staff confirms check-in
4. Walk-in registration available for clients without appointments
5. Last check-in reprint option available

### Connectivity Modes
| Mode | How it works | When to use |
|------|-------------|-------------|
| **LAN (direct API)** | Kiosk calls `POST /queue/checkin` or `POST /fra/checkin` on Nexus backend directly | Kiosk is on same LAN as Nexus server |
| **External (Supabase bridge)** | Kiosk inserts into `kiosk_checkins` table → subscribes to Realtime → Nexus backend processes and updates row → Kiosk receives queue number | Kiosk is outside LAN (e.g., lobby on different network) |

Both modes produce the same result: a queue number + thermal ticket.

### Queue Number Series
| Type | Start | Display Format | Example |
|------|-------|---------------|---------|
| Regular | 6001 daily | Plain number | 6001, 6002 |
| OWWA | 9001 daily | Plain number (same series for appt + walk-in) | 9001, 9002 |
| FRA | 1 daily | A-prefix + 3 zero-padded digits | A001, A002 |
| Walk-in Regular | 601 daily | W-prefix | W601, W602 |

### Appointment Name Fields (Supabase → Kiosk)
The Supabase `appointments` table uses OFW-prefixed name columns:
- `ofw_fname` — first name
- `ofw_lname` — last name (required)
- `ofw_mname` — middle name (nullable)
- Display as: `[ofw_fname, ofw_mname, ofw_lname].filter(Boolean).join(' ')`

Additional OFW fields available for display: `ofw_gender`, `ofw_visa`, `ofw_position`, `ofw_trans`, `p_name` (principal/employer name), `client_contact`.

---

## 1. Authentication & Login

1. Enter **username** and **password**
2. Click **Sign In**
3. System prompts for **6-digit TOTP code** from authenticator app (mandatory for all staff)
4. Enter code, click **Verify Code**
5. Dashboard loads with role-based navigation

**Roles:** ADMIN, PROCESSOR, CASHIER, VIEWER, OWWA

---

## 2. Attendance (Time In / Time Out)

### Morning
1. Navigate to **HR > Time In / Out**
2. Click **Time In** with today's date
3. System records time and marks **On Time** or **Late** (cutoff: 8:00 AM)

### End of Day
1. Click **Time Out**
2. System calculates working hours

### Daily Summary (visible to all)
- Total staff present, on time, late, absent
- Individual staff breakdown with timestamps

---

## 3. Contract Verification (CV) — Primary Queue Workflow

### Phase 1: Calling the Queue

- Clients arrive via Supabase appointments (auto-synced)
- Queue numbers auto-generated starting at **6000** per day
- Navigate to **Services > Contract Verification**
- Counter must be set in **Settings > Staff** first (shown as read-only on the page)

1. Click **Call Next** — picks first WAITING client, assigns your counter
2. Client status changes to **CALLED**
3. Display shows: Queue #, Name, Service Type, Wait Time

### Phase 2: Serving the Client

**If client arrives:**
1. Click **Serve** — form auto-populates from Supabase appointment data
2. Status changes to **PROCESSING**
3. Review pre-filled fields:
   - Full name (Last, First, Middle)
   - Email, Mobile
   - Employer, Position
   - Work Permit type (Work Permit / SPass / EPass)
   - Transaction type (New Record / Change of Employer / Renewal / etc.)
   - Gender
4. Edit any fields as needed

**If client doesn't arrive:**
1. Click **Miss** — status changes to **MISSED**
2. Entry moves to bottom "Missed" tab

### Phase 3: Completion

**Process (successful):**
1. Click **Process** — status changes to **SUBMITTED**
2. Entry moves to "Processed" tab
3. Client is now ready for receipt issuance

**Defer (schedule for later):**
1. Click **Deferred** — enter reason (e.g., "Missing documents")
2. Status changes to **DEFERRED**
3. Client can return without a new appointment

### Bottom Table Tabs
- **Processed:** Completed CVs, ready for OR issuance
- **Deferred:** Clients to be re-served (shows reason)
- **Missed:** No-shows

From any tab, click **Serve** to re-process a client.

---

## 4. Receipt & OR (Official Receipt) Issuance

### Setup
- Navigate to **Services > Receipt**
- 7-digit OR numbers auto-increment (e.g., 0000001, 0000002...)
- Current OR number displayed at top of page

### Issue OR
1. View **PROCESSED** tab — clients awaiting OR (oldest first)
2. Each row shows: Queue #, Client Name, Employer, Position, Service Type, Amount (SGD)
3. Click **Issue OR** on the client's row
4. System auto-assigns next OR number
5. Status changes to **OR_ISSUED** — entry moves to OR_ISSUED tab

### Special Operations

**OVERRIDE (one-time adjustment):**
- Click **OVERRIDE** — enter desired OR number
- Only applies to the next issuance; sequence resumes normally after

**CHANGE SERIES (restart numbering):**
- Click **CHANGE SERIES** — enter new starting number
- ADMIN-only action (logged in audit trail)
- Use when: opening new station, correcting errors

### API Paths (Dual Transaction Paths)
The Receipt page uses two backend API paths that share the same database tables:

| Path | Purpose |
|------|---------|
| `/api/queue/transactions/*` | **Operational path.** Lists transactions by date/status, issues ORs during queue processing, handles receipt printing (ESC/P and HTML). Used by the Receipt page for day-to-day issuance. |
| `/api/transactions/*` | **Canonical/reference path.** OR series management (`getOrSeriesInfo`, `changeOrSeries`), void operations, lookup by OR number. Source of truth for the future Reports module. |

Both paths are intentional — do not consolidate them.

### Key Rules
- All service types share a **single OR series** — there is no per-service-type split
- The series only changes when **new booklets are provided** (admin "Change Series" action)
- OR numbers must **never skip, duplicate, or reset** without admin action
- Voided ORs are marked voided — not reused, not skipped
- Every issuance and override is logged in the audit trail

---

## 5. Live Queue Monitor

Navigate to **Services > Live Window** — read-only monitoring display.

### Stats Cards
1. **Waiting:** Total count of clients in queue (WAITING + CALLED), with breakdown: **N Regular** | **N FRA**
2. **Served Today (by Staff):** Breakdown per staff member
3. **Total Served Today:** Sum of completed clients

### Queue Table (3 tabs)
- **Waiting:** Clients in WAITING or CALLED status
- **Served:** Completed or deferred clients
- **Missed:** No-shows

Each row: Queue #, Client Name, Service Type, Wait Time, Status badge

Updates every 30 seconds. No interaction needed.

### Queue Display (TV Monitor)
- **URL:** `/queue-display` (public, no auth) — designed for TV/monitor display
- Shows up to 8 entries: **CALLED** entries pulse (red, animated), **PROCESSING** entries persist (solid, black)
- CALLED entries appear at top, PROCESSING entries below — older entries scroll off the bottom
- Multiple counters can pulse simultaneously (each showing their counter number)
- No two active counters can be set to the same number (enforced by backend)
- FRA entries display with "A" prefix (e.g., "A001")
- Chime sound plays only when new CALLED entries appear (not when entries move to PROCESSING)
- Auto-refreshes every 3 seconds

---

## 6. Accreditation (Applications) — Multi-Day Processing Workflow

Navigate to **Regulatory > Applications**

### Phase 1: Submissions Table

**Tabs:**
| Tab | Shows |
|-----|-------|
| All Pending | Not yet due or overdue |
| Due Soon | Within 2 working days of 112h deadline |
| Overdue | Past 112h cycle time |
| Resolved | Processed, denied, or deferred |

**Table Columns:**
- **Date / Cycle** — Submission date + cycle time progress bar
  - Green: on track, Amber: due soon, Red: overdue
  - Pause icon if timer is paused (Freshdesk status = Pending)
- **Principal** — Company name + Control Number
- **Transaction** — Type (New Accreditation, Renewal, Additional JO, etc.)
- **PRA** — Philippine Recruitment Agency
- **D. Employer** — Direct Employer (if applicable)
- **FD#** — Button that opens Freshdesk ticket at `services.mwosingapore.com` in new window
- **Evaluator** — Auto-assigned staff (round-robin), clickable dropdown to reassign
- **Status** — Transaction status badge (Pending, Received, For Submission, with Deficiency, For Site Visit, For Interview, Approved, Deferred/Denied, Closed). ADMIN users can click the badge to change status via dropdown.

**Actions (per row):**
- **Process** — Opens detailed form
- **"..."** menu with:
  - **Endorse for Site Visit** — Creates `site_visits` row in Supabase, sets status to "For Site Visit"
  - **Set Interview** — Opens pre-filled Google Calendar event (with Google Meet) in new tab, prompts for meeting details, sets status to "For Interview", sends Freshdesk ticket reply notifying applicant about the scheduled interview with the Labor Attache
  - **Defer** — Prompts for reason, logs deferral
  - **Deny** — Prompts for reason, logs denial

### Phase 2: Process Form

Opened by clicking **Process** on a submission.

**Form Sections:**

1. **Classification & Transaction**
   - App Type: Landbased / Seabased
   - Classification: FRA-MDW, FRA-Except-MDW, Direct Employer, Service Contractor, Shipowner, Ship Manager, Crew Manager
   - Transaction: New Accreditation, Renewal, Additional JO, Enrolment of New Employer, Multiple Accreditation, Verification, Others
   - PRA: Searchable field

2. **Principal Details**
   - Name, UEN, Auth. Representative, Position
   - Address, Zip, Country
   - Email, Contact No.

3. **MDW Welfare Details** *(shown only for FRA-MDW)*
   - WEDO Name, Contact
   - Accommodation Address, Type (Condo/HDB/Landed), Rooms

4. **Direct Employer Details** *(shown only for FRA types)*
   - Name, UEN, Auth. Rep, Position
   - Address, Zip, Email, Contact, Activity

5. **Job Orders** *(dynamic table)*
   - Per row: Position, Salary, Skill Level, No. of Workers
   - Add/remove rows

6. **PRA Details**
   - PRA Auth. Representative, Position

7. **Documents Submitted** *(checklist)*
   - System shows required documents based on app type + transaction
   - Each doc: checkbox, label, upload status (Uploaded/Not uploaded), charge indicator
   - **Chargeable documents** (60 SGD each): Recruitment Agreement, Special Power of Attorney, Master Employment Contract, Job Order
   - All other documents: supporting (no charge)
   - "Others" checkbox with text input for additional docs
   - **Charge Amount** — auto-calculated total displayed at bottom

**Actions:**
| Button | What it does |
|--------|-------------|
| Back | Return to submissions table |
| Apply Edits | Save changes to submission only (no Transaction created) |
| Confirm & Process | Creates Transaction + OR in local DB, marks submission as processed |

### Certificate of Accreditation
*(Shown only for Landbased + New Accreditation or Renewal)*
- Click **Issue Certificate of Accreditation**
- Generates PDF, computes SHA-256 hash, stores on NAS

### Digital Verification *(Future)*
- ADMIN: Upload files, VERIFY (generates SHA-256 hashes + cover page)
- Staff: RECOMMEND FOR APPROVAL

### Cycle Time Rules
- **112 working hours** (14 working days, Mon-Fri, 8AM-5PM)
- Timer pauses when Freshdesk ticket status = **Pending** (awaiting client response)
- Timer resumes when status = **Open** (client has replied)
- Overdue submissions highlighted in red

### Evaluator Assignment
- New submissions auto-assigned via **round-robin** to ADMIN/PROCESSOR staff
- Manual reassignment available

---

## 7. Queue Status Transitions (Reference)

### Regular / OWWA Queue
```
WAITING → CALLED (staff clicks "Call Next")
CALLED → PROCESSING (staff clicks "Serve")
CALLED → MISSED (staff clicks "Miss")
CALLED → DEFERRED (staff clicks "Deferred" + reason)
PROCESSING → SUBMITTED (staff clicks "Process")
PROCESSING → CONFIRMED (FRA: cashier confirms submission)
PROCESSING → DEFERRED (staff clicks "Defer" from processing)
PROCESSING → PROCESSED (staff clicks "Process" directly)
SUBMITTED → PROCESSED (automatic)
CONFIRMED → PROCESSED (FRA: admin processes)
PROCESSED → OR_ISSUED (cashier clicks "Issue OR")
```

### FRA Queue (Agency Hire)
```
WAITING → CALLED (cashier clicks "Call Next" with counter)
CALLED → CONFIRMED (cashier confirms submission + prints payment order)
CONFIRMED → PROCESSED (admin processes — creates transactions)
PROCESSED → OR_ISSUED (admin batch issues OR — consecutive numbers)
```

### Supabase FRA Registration Status (per contract)
Supabase CHECK constraint allows only: `pending`, `arrived`, `completed`, `cancelled`.
```
pending → arrived (QR check-in at front desk)
arrived → completed (admin processes for OR issuance)
```
Nexus-only states tracked via `staff_notes` tags (not Supabase status column):
- `[NEXUS:DEFERRED]` — cashier defers individual contract (staff_notes prefix)
- `[NEXUS:REMOVED]` — ADMIN soft-delete (staff_notes prefix)
- Restored by clearing staff_notes to null

**Per-contract deferred flow:** Individual ref_codes within a transaction_ref can be deferred independently via staff_notes tags. When confirming, only non-deferred contracts proceed. If all contracts are deferred, the queue entry becomes DEFERRED. Client can return with the same transaction_ref — only deferred contracts re-enter the queue via the **Return** button on the Check-in page.

**Terminal states:** OR_ISSUED, MISSED, DEFERRED, RECEIVED

---

## 8. Check-in / Front Desk Workflow

Navigate to **Backend > Check-in** — this is the entry point for all clients arriving at the office.

### Tabs
- **Regular / OWWA** — For appointment-based check-ins and walk-ins (CV, OWWA, DH)
- **FRA Registration** — For agency FRA transaction check-ins

### QR Scan Check-in (Regular/OWWA)
1. Staff focuses the scan input field (auto-focused on page load)
2. Client presents QR code from their appointment confirmation
3. HID scanner reads QR → reference code appears in input → Enter triggers check-in
4. System calls `POST /queue/checkin` with the reference code
5. Backend fetches appointment from Supabase, matches client by email against local `clients` table
6. Queue entry created with auto-generated queue number (starting at 6000 daily)
7. If **auto-print** is enabled, thermal ticket prints automatically (configurable paper width: 58mm/80mm)
8. Result card shows: queue number, client name, service type, queue series, match status

### QR Scan Check-in (FRA)
1. Switch to **FRA Registration** tab
2. Scan the agency's transaction reference QR code
3. System calls `POST /fra/checkin` with the transaction_ref
4. All workers under that transaction_ref are checked in as a group (status: WAITING)
5. If already checked in, system shows "already checked in" notice
6. Auto-print generates FRA-specific ticket with display number (e.g., "3A")

**Note:** FRA check-in is done **only** from this Check-in page. The Agency Hire page (Services > Agency Hire) does not have a check-in bar — it handles processing only.

### Return (Deferred Client)
1. Click **Return** button (top right, amber) — opens scanner/input modal
2. Scan QR or manually enter `ref_code` or `transaction_ref`
3. System searches: local deferred queue entries + Supabase FRA deferred contracts
4. If found: shows deferred entry details + queue type selector (Regular / OWWA / FRA)
5. Click **Re-enter Queue** — creates new WAITING queue entry (or reactivates existing deferred one)
6. For FRA: deferred contracts are restored to `arrived` status in Supabase

### Walk-in Registration
1. Click **Walk-in** button (top right)
2. Modal opens with fields: service type, first/last/middle name, email, mobile, employer (DH only)
3. Select service type: MDW CV, Skilled CV, OWWA, Direct Hire, or FRA Registration
4. Submit creates a client profile + queue entry in one action
5. Auto-print if enabled

### Printer Settings
- **Auto-print toggle**: Automatically print ticket on successful check-in
- **Paper width**: 58mm (narrow thermal) or 80mm (standard thermal)
- Settings persist in browser localStorage

### Stats Displayed
- **Checked in**: Total queue entries today
- **Waiting**: Entries still in WAITING status
- **Served**: All entries past WAITING (excludes MISSED/DEFERRED)

### Today's Queue Table
- Shows all entries for the day with: #, Name, Service, Status badge, Time
- Refreshes every 15 seconds

---

## 8b. Appointments Management

Navigate to **Backend > Appointments**

### Filters
- **Date** — Single date or date range (toggle checkbox)
- **Service** — Multi-checkbox filter (MDW-CV, Skilled-CV, OWWA, DH). OWWA users auto-locked to OWWA. Supports selecting multiple services simultaneously.
- **Status** — Dropdown (All, Pending, Confirmed, Completed, Cancelled, No Show)

### Actions
- **Create Appointment** — Staff override: always creates appointment even if slots are full. Uses fallback slot if exact time/day match unavailable.
- **Revise** — Edit date, time, client info, staff notes. Backend auto-recalculates `end_time` and re-resolves `slot_id` when date/time changes. If original slot unavailable, falls back to any active slot.
- **Cancel** — Sets status to "cancelled", sends cancellation email
- **Export CSV** — Downloads filtered appointments as CSV

### Slot Override Behavior
Staff-created/revised appointments always succeed even when:
- The exact time slot has no matching `weekly_slots` entry → falls back to any active slot for the service
- The service has no slots at all → falls back to any active slot in the system
- The slot capacity is exceeded → appointment created regardless (staff override)

---

## 9. FRA / Agency Hire Workflow

Navigate to **Services > Agency Hire**

### Overview
FRA (FRA Registration) handles bulk worker registrations from recruitment agencies. Unlike individual CV clients, FRA comes as **grouped transactions** — one agency transaction_ref covers multiple workers processed together.

**Two-phase workflow:** CASHIER confirms submissions and prints payment orders → ADMIN processes for OR issuance. These phases can span multiple days.

### Roles
- **CASHIER** — Calls queue, reviews workers, edits/removes/restores, confirms submission, prints payment order
- **ADMIN** — Processes confirmed groups (creates transactions), issues batch OR numbers, can also edit/delete/restore confirmed entries
- **PROCESSOR** — Same access as CASHIER

### Page Layout
- **Header:** Title + summary stats + date filter
- **Call Panel:** "Call Next" button (uses counter from Settings > Staff)
- **Top Container (tabbed):**
  - **Now Serving** tab — CALLED groups with worker tables, "Confirm Submission" button
  - **Waiting** tab — WAITING groups (read-only, shows count)
- **Bottom Container (tabbed):**
  - **Confirmed** tab — CONFIRMED and PROCESSED groups (multi-day, persists across dates). ADMIN actions: Process, Issue OR
  - **OR Issued** tab — OR_ISSUED groups with OR number ranges

### Check-in (separate page)
Check-in happens on **Backend > Check-in** (FRA tab), not on the Agency Hire page. Staff scans agency QR → queue entry created (WAITING).

### Phase 1: CASHIER Confirms Submission
1. CASHIER clicks **Call Next** → system picks next WAITING FRA entry, assigns counter number
2. Entry appears in "Now Serving" tab with expandable worker table
3. CASHIER reviews worker list, edits if needed (Edit/Remove/Restore per worker)
4. Click **Confirm Submission** on the group card
5. System calls `POST /fra/transaction-refs/{ref}/confirm`
6. Queue status → **CONFIRMED**, Supabase rows → `confirmed`
7. **Payment Order receipt prints automatically** (thermal, 80mm) — two copies:
   - **Customer Copy** and **MWO Copy** (single print dialog with page break)
   - Content: MWO header, queue number, date, **release date** (2 working days Mon-Fri from confirmation), FRA/PRA names, worker list (name + employer), contract count, rate (S$60), total amount
8. Group moves to "Confirmed" tab

### Phase 2: ADMIN Processes & Issues OR
1. ADMIN opens "Confirmed" tab — sees all confirmed groups (including from previous days)
2. Click **Process** on a confirmed group
3. System calls `POST /fra/transaction-refs/{ref}/process` (ADMIN only)
4. Creates transaction records in Supabase + local PostgreSQL for each active worker
5. Supabase rows → `completed`, queue status → **PROCESSED**
6. Click **Issue OR** on the processed group
7. System calls `POST /fra/transaction-refs/{ref}/batch-issue-or`
8. **Batch issuance:** One click issues N consecutive OR numbers for all workers in the group
9. Queue status → **OR_ISSUED**, group moves to "OR Issued" tab

### ADMIN Actions on Confirmed Groups
| Action | What it does |
|--------|-------------|
| **Process** | Creates transactions, marks Supabase completed, moves to PROCESSED |
| **Issue OR** | Batch issues consecutive ORs for all workers (PROCESSED → OR_ISSUED) |
| **Edit** | Reopens group for re-editing (CONFIRMED → CALLED) |
| **Delete** | Soft-deletes workers from the group |
| **Restore** | Restores soft-deleted workers |

### Multi-Day Persistence
- **Today's queue:** Waiting and Called groups appear based on the date filter
- **Confirmed/Processed groups persist across days** — a submission confirmed today can be processed tomorrow and OR'd another day
- The bottom container always shows all outstanding CONFIRMED and PROCESSED groups regardless of date

### Worker Table (expanded group)
Per worker row: #, Last Name, First Name, Middle, Employer, Contact, Txn Type, Salary, Rest Days, Leave Days, Period
- **Edit** — modal to modify worker details
- **Defer** — marks individual contract as `deferred` in Supabase, excluded from counts. Client can return later with deferred contracts only.
- **Remove** — ADMIN only, hard-deletes worker (`nexus_removed`), excluded from counts
- **Restore** — un-defers or un-deletes a worker back to `arrived` status

### Key Rules
- **S$60 per contract** — fixed rate, total = activeCount × 60
- **FRA queue series** — Numbers start at 1 daily, displayed as `A001`, `A002`, `A003`
- **Walk-in FRA series** — `WA01, WA02...`
- **No client FK** — FRA transactions store name fields directly (no `clients` table link)
- **Counter required** — Set in Settings > Staff before calling. Appears on Queue Display TV
- **Per-contract deferred** — Individual workers can be deferred; remaining contracts proceed. If all are deferred, queue entry becomes DEFERRED. Client can return via Return button on Check-in page.

### Polling
Page auto-refreshes every 15 seconds (silent — no loading spinner flash).

---

## 10. OWWA Service Window Workflow

Navigate to **Services > OWWA**

### Overview
OWWA (Overseas Workers Welfare Administration) is a separate service window with its own queue series. Clients with OWWA appointments are filtered into the `OWWA` queue series and processed independently from regular CV clients.

### Counter Assignment
Counter is set in **Settings > Staff** (not on this page). OWWA role gets counters 8-10. The assigned counter is used automatically when calling clients and appears on the Queue Display TV.

### Calling Clients
**Call Next:**
1. Click **Call Next** — picks the first WAITING entry in the OWWA queue series
2. Client info displayed: Queue #, Name, Service Type, Wait Time
3. Status changes to CALLED

**Call By Number:**
1. Enter a specific queue number in the input field
2. Click **Call** — pulls that specific entry regardless of position
3. Useful for re-calling missed clients or handling out-of-order requests

### Serving a Client
Once a client is called, three actions are available:

**Served (RECEIVED):**
- Click **Served** — marks client as RECEIVED (terminal state for OWWA)
- OWWA does not go through the OR issuance flow

**Miss:**
- Click **Miss** — status changes to MISSED
- Entry moves to Missed tab

**Defer:**
- Click **Defer** — shows reason input
- Enter reason (e.g., "Missing documents") and confirm
- Status changes to DEFERRED with reason stored

### Transfer
- Click **Transfer** — select target counter number
- Queue entry reassigned to different counter/staff

### Re-activation
- From the **Deferred** tab, click **Reactivate** on any entry
- Entry returns to WAITING status and re-enters the queue

### Bottom Tabs
| Tab | Shows |
|-----|-------|
| Served | Entries with RECEIVED status |
| Deferred | Entries with DEFERRED status (shows reason) |
| Missed | Entries with MISSED status |

### Key Differences from CV Queue
- Uses `OWWA` queue series (filtered separately from REGULAR)
- Terminal state is **RECEIVED** (not OR_ISSUED — no receipt issuance)
- Counter assignment is independent per OWWA processor
- No transaction/process form — just call, serve, done

### Polling
Queue refreshes every 10 seconds. Wait time updates every 30 seconds.

---

## 11. Counter Assignment

The counter module manages which staff member is assigned to which service counter. Counter assignment is **global** — once set, it applies across all modules (Contract Verification, Agency Hire, OWWA, etc.).

### Where to Set
Navigate to **Settings > Staff** — "Counter Assignment" section.

### Role-Based Counter Ranges
| Role | Available Counters |
|------|-------------------|
| ADMIN, PROCESSOR, CASHIER, VIEWER | **1–7** |
| OWWA | **8–10** |

### How It Works
1. Staff selects a counter number from the dropdown
2. Clicks **Set Counter** — backend calls `POST /counter/assign`
3. Counter is now active and used in all queue operations (Call Next, etc.)
4. To release: click **Reset (No Counter)** — calls `DELETE /counter/release`
5. Active counters are shown below the selector (all staff assignments)

### Top Bar Status
The dashboard top bar always shows:
> **Logged as:** Full Name **|** **Counter:** N (or *no counter set*)

This fetches from `GET /counter/me` on page load.

### Queue Display Integration
The **QueueDisplayPage** (`/queue-display`, TV monitor) shows "Now Serving" with the counter number. FRA entries display with "A" suffix (e.g., "3A"). This tells clients which window to approach.

### API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /counter/assign` | Assign counter (body: `{ counterNumber }`) — stores full name from users table |
| `DELETE /counter/release` | Release current counter |
| `GET /counter/me` | Get current user's active counter assignment |
| `GET /counter/active` | Get all active counter assignments |

---

## 12. Admin Module Workflows

Navigate to **Admin** (sidebar, ADMIN role only)

### Staff Management (`/admin/staff`)
1. View all staff in a searchable table (username, name, email, role, 2FA status, active)
2. **Create Staff** — modal with username, password, full name, email, role
3. **Change Role** — inline dropdown on each row, immediate save + audit log
4. **Edit Details** — modal to update full name and email
5. **Toggle Active** — click the Active/Inactive badge to enable/disable account
6. **Reset 2FA** — confirmation dialog, clears TOTP secret so user must re-enroll
7. **Reset Password** — modal to set new temporary password (min 8 chars)
- All actions are audit-logged with the admin's identity and old/new values

### Module Access (`/admin/modules`)
1. Matrix grid: rows = module groups (expandable to individual pages), columns = roles
2. Click group arrow to expand and see child pages
3. Toggle checkboxes per role. ADMIN row is always full-access (disabled)
4. Click **Save Changes** to persist to `system_config` table
5. Takes effect on next page load for affected users

### Calendar Settings (`/admin/calendar`)
1. View/edit MWO and OWWA Google Calendar IDs
2. Save stores to `system_config` with env var fallback
3. Backend uses DB value first, then env var

### Office Orders (`/admin/office-orders`)
1. **Upload** — modal with reference no, title, issue date, category (Memorandum/Circular/Advisory/Directive/Other), PDF file
2. Files stored on NAS at `OFFICE_ORDERS_PATH`
3. View/download PDF, edit metadata, delete with confirmation
4. All staff can view orders from **Comms > Office Orders** (read-only)

### Announcements (`/admin/announcements`)
1. Create/edit announcements with title, content, priority (INFO/WARNING/URGENT), optional expiry
2. Toggle active/inactive per announcement
3. All staff see active announcements on **Comms > Announcements** page
4. Priority-based styling: INFO=blue, WARNING=amber, URGENT=red

### Audit Logs (`/admin/audit-logs`)
1. Paginated table of all `audit_logs` entries
2. Filters: action type, target table, date range
3. Click row to expand and see metadata JSON
4. Read-only — no edit or delete

### System Health (`/admin/health`)
1. Database connection status
2. Record counts (users, transactions, queue entries)
3. Refresh button for on-demand checks

---

## 13. Typical Daily Workflow (Morning Shift)

**08:00 AM — Arrival:**
1. Log in with username + password + 2FA code
2. Click **Time In** to record attendance
3. Go to **Settings > Staff** and set your counter number

**08:00-10:00 AM — Queue Processing (CV):**
1. Open Contract Verification page
2. **Call Next** → **Serve** → review data → **Process**
3. Repeat for each client (typically 10-15 per shift)

**08:00-10:00 AM — Agency Hire (CASHIER):**
1. Open Agency Hire page
2. **Call Next** → review workers → edit if needed → **Confirm Submission**
3. Payment order prints automatically (2 copies)
4. Repeat for each agency group

**10:00 AM — Receipt Issuance:**
1. Open Receipts & OR Issuance
2. Issue ORs for all processed CV clients
3. Print receipts

**10:00 AM — FRA Processing (ADMIN):**
1. Open Agency Hire page → Confirmed tab
2. **Process** confirmed groups → **Issue OR** (batch)
3. Each group gets consecutive OR numbers in one click

**Ongoing — Accreditation Review:**
1. Check Regulatory > Applications page for pending submissions
2. Review overdue/due-soon items first
3. Open Process form, verify documents, confirm charge amount
4. Click **Confirm & Process**

**End of Day:**
1. Check Live Window for any remaining queue items
2. Click **Time Out** to record departure

---

## 14. Key Operational Rules

| Rule | Detail |
|------|--------|
| 2FA mandatory | All logins require TOTP code, no exceptions |
| OR numbers never skip | Voided = marked voided, not skipped or reused |
| Regular queue starts at 6000 | Per day, auto-incremented |
| FRA queue starts at 1 | Per day, displayed as `A001`, `A002`, etc. |
| FRA two-phase workflow | CASHIER confirms → ADMIN processes. Can span multiple days |
| CONFIRMED status | FRA-specific: cashier has verified, payment order printed, awaiting ADMIN processing |
| Counter set in Settings | Global counter assignment (1-7 regular, 8-10 OWWA). Applies across all modules |
| Accreditation cycle | 112 SGT working hours (Mon-Fri, 8AM-5PM SGT) from submission |
| SGT timezone | All date comparisons use Singapore Time (UTC+8) via `sgt-date.ts` helpers |
| Deferral needs reason | Free text, stored for reference |
| PII stays on NAS | No client documents uploaded to external cloud |
| Audit logging | Every state change, document action, OR issuance logged |
