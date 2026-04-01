# Nexus Ecosystem — Recommendations & Implementation Plan
> Two-part document: Strategic Recommendations + Implementation Plan
> Scope: Nexus Kiosk (check-in), Nexus Backend (queue processing), AgencyHire (appointment booking)
> Scale: 200-400 transactions/day, ~15 min avg service time, 10-15 staff, 5 service types

---

# PART 1: STRATEGIC RECOMMENDATIONS

---

## Executive Summary

Your current system has solid bones. AgencyHire handles booking, Nexus Kiosk handles check-in, and Nexus Backend handles queue processing — all connected through Supabase. The architecture is sound.

But the system currently treats each interaction as isolated: book → arrive → scan → wait → serve. The biggest opportunity is **connecting these moments into a continuous client experience** — from the moment someone books to the moment they walk out with their receipt.

The recommendations below are organized into three tiers:
- **Tier 1 — High Impact, Low-Medium Effort** (do these first, measurable results in weeks)
- **Tier 2 — High Impact, Medium Effort** (the differentiators, 1-2 month horizon)
- **Tier 3 — Transformative, Higher Effort** (the no-receptionist future, 3-6 month horizon)

---

## Current State Assessment

### What Works Well
- QR-based check-in flow is fast (~3-5 seconds from scan to ticket)
- Supabase RPC queue number generation is concurrency-safe
- Dual-mode kiosk (receptionist/self-service) is well-implemented
- FRA batch processing handles the complex agency workflow
- Service-type separation (REGULAR, OWWA, FRA) prevents queue cross-contamination
- Priority system (3 for appointments, 7 for walk-ins) ensures appointment holders are served first

### What's Missing
| Gap | Impact | Current Workaround |
|-----|--------|--------------------|
| No estimated wait time | Clients sit anxiously with no visibility | Staff verbally estimates |
| No SMS/WhatsApp notifications | 15-25% no-show rate, missed calls at counter | Staff calls client name |
| No pre-arrival check-in | Every client must physically scan at kiosk | Receptionist scans for them |
| Simplistic queue display | TV shows who's called, nothing else | Clients stare at screen |
| No reminder system | Clients forget appointments | Email only at booking time |
| No smart routing | Manual "Call Next" is FIFO only | Staff manually coordinate |
| No crowd management data | No visibility into waiting area load | Receptionist eyeballs it |
| Walk-ins have no self-service path | Requires receptionist for name entry | Receptionist types it in |

### Critical Backend Issues Found
| Issue | Risk | Location |
|-------|------|----------|
| Dual kiosk listeners (SupabaseService + KioskBridgeService) | Race condition on PENDING processing | `supabase.service.ts` + `kiosk-bridge.service.ts` |
| call_count not reset on reactivation from DEFERRED | Auto-miss on first call after re-entry | `queue.service.ts` |
| EWT calculation is simplistic (flat average) | Inaccurate wait estimates | `queue.service.ts` |
| Service type mapping duplicated in 3+ places | Drift risk, maintenance burden | kiosk-bridge, supabase.service, queue.service |
| FRA `[NEXUS:DEFERRED]` string-tag in staff_notes | Brittle, no dedicated column | `fra.service.ts` |
| No circuit breaker on Supabase realtime | Silent failure, no alerting | `supabase.service.ts` |

---

## Tier 1 Recommendations — High Impact, Do Now

### 1.1 Estimated Wait Time on Ticket + Queue Display

**The single highest-impact change you can make.** Research shows that displaying estimated wait time reduces perceived wait by 20% and complaints by 25-35%. When clients know "~18 minutes", they relax. When they don't know, every minute feels like five.

**Current state:** The Nexus backend already has a basic `getEstimatedWaitTime()` that calculates average processing time. But it's not surfaced on the thermal ticket or prominently on the TV display.

**Recommendation:**

Print on every thermal ticket from the kiosk:
```
Queue Number: 6015
Service: Contract Verification
Position: 8th in line
Est. wait: ~20 minutes
```

Show on the queue display TV:
```
┌──────────────────────────────────────────────────────┐
│  NOW SERVING                                          │
│  Window 1: 6015 (CV)  │  Window 2: 6018 (CV)        │
│  Window 3: A003 (FRA) │  Window 5: 9005 (OWWA)      │
│                                                       │
│  NEXT: 6019 → 6020 → 6021 → A004                    │
│                                                       │
│  Waiting: 12  │  Avg wait: ~18 min  │  Served: 47   │
└──────────────────────────────────────────────────────┘
```

**Formula:**
```
estimatedWaitMinutes = (peopleAheadInSeries × avgServiceTimeForType) / activeCountersForType
```

Where:
- `peopleAheadInSeries` = count of WAITING + CALLED in same queue_series today
- `avgServiceTimeForType` = 7-day rolling weighted average of (completed_at - called_at)
- `activeCountersForType` = staff currently assigned to counters for that service

**Why weighted average:** Recent days get more weight (yesterday's data matters more than last Tuesday). Accounts for staff learning, seasonal complexity changes.

---

### 1.2 Enhanced Queue Display TV

**Current state:** Shows CALLED (pulsing) and PROCESSING (solid) entries, max 8 rows. Chime on new CALLED. EWT in footer.

**Recommendation:** Redesign the display to serve as the **primary communication channel** with the waiting area.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  MIGRANT WORKERS OFFICE SINGAPORE          31 Mar 2026      │
│ ─────────────────────────────────────────────────────────── │
│                                                              │
│  NOW SERVING                                                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐│
│  │ WINDOW 1   │ │ WINDOW 2   │ │ WINDOW 3   │ │ OWWA     ││
│  │   6015     │ │   6018     │ │   A003     │ │   9005   ││
│  │  CV-Skilled│ │  CV-MDW    │ │  FRA       │ │  OWWA    ││
│  └────────────┘ └────────────┘ └────────────┘ └──────────┘│
│                                                              │
│  NEXT UP                                                     │
│  6019 → 6020 → 6021 → A004 → 9006                         │
│                                                              │
│ ─────────────────────────────────────────────────────────── │
│  Waiting: 12 clients  │  Avg wait: ~18 min  │  Served: 47  │
│                                                              │
│  ℹ Please have your documents ready before your number      │
│    is called. Appointment clients are served first.          │
└─────────────────────────────────────────────────────────────┘
```

**New elements:**
- **"Next Up" row** — shows the next 5 queue numbers across all series. Gives clients near the front a heads-up.
- **Stats bar** — waiting count, average wait, served today. Creates a sense of progress.
- **Info banner** — rotating messages: document prep reminders, walk-in priority notice, service announcements. Configurable from `system_config` or `announcements` table.
- **Multi-counter layout** — show all active counters simultaneously (not just a flat list).

---

### 1.3 Fix Critical Backend Issues

These are bugs/risks that should be fixed before adding new features.

**1.3a — Consolidate kiosk listeners.**
Remove the duplicate listener in `SupabaseService`. Keep only `KioskBridgeService` for PENDING → WAITING processing. The current dual subscription creates a race condition where both services try to process the same PENDING entry.

**1.3b — Reset call_count on reactivation.**
When a DEFERRED entry re-enters the queue, `call_count` must be reset to 0. Currently, a client who was deferred and called twice before deferral would be auto-missed on their very first call after re-entry (count starts at 2, auto-miss at 3).

**1.3c — Extract service type mapping to a single source.**
The SLUG → (series, serviceType) mapping exists in:
- `kiosk-bridge.service.ts` (SERVICE_SLUG_MAP)
- `supabase.service.ts` (similar map)
- `queue.service.ts` (implicit)
- Nexus Kiosk `constants.ts` (SLUG_MAP)

Create one shared constant (or a `system_config` entry) that all consumers read from.

**1.3d — Add Supabase realtime connection monitoring.**
When the realtime subscription drops (network blip, Supabase restart), there's no alert. Add a heartbeat check + reconnection logic + admin notification (via `announcements` or dashboard alert).

---

### 1.4 Waiting Area Position on Kiosk Success Screen

After check-in, the kiosk currently shows: queue number + "Proceed to the waiting area."

**Add:** "You are **#8** in line. Estimated wait: **~20 minutes**."

This is a one-line change in the kiosk app using data already available (count WAITING entries ahead in the same series + the EWT formula from 1.1).

**Why this matters:** Research shows that the transition from "I have a number" to "I know how long I'll wait" is the single biggest anxiety reducer. David Maister's foundational research (Harvard) confirms: **uncertain waits feel dramatically longer than known, finite waits.**

---

## Tier 2 Recommendations — The Differentiators

### 2.1 WhatsApp/SMS Notification System

This is the **second highest-impact feature** after estimated wait times. WhatsApp has near-universal penetration among OFWs in Singapore. Studies show WhatsApp reminders reduce no-shows by **60-70%**.

**Notification timeline:**

| Timing | Channel | Message |
|--------|---------|---------|
| Booking confirmation | Email + WhatsApp | "Confirmed: [date] at [time]. Your ref: [code]. QR attached." |
| T-24 hours | WhatsApp | "Reminder: Your MWO appointment is tomorrow at [time]. Reply CANCEL if you can't make it." |
| T-2 hours | WhatsApp | "Your appointment is in 2 hours. Tap to check in now: [link]" |
| T-15 min (if not checked in) | WhatsApp | "Your appointment starts in 15 min. Are you on your way?" |
| Checked in | WhatsApp | "Checked in! You are Q#[number], position [X]. Est. wait: ~[Y] min." |
| 3 positions away | WhatsApp | "Your turn is approaching. Please move to the waiting area near the counters." |
| Called to counter | WhatsApp | "Q#[number], please proceed to Window [X] now." |

**Impact breakdown:**
- T-24h + T-2h reminders: **~50% no-show reduction**
- "Your turn approaching" alert: **~90% reduction in missed calls** (client is at counter before name is called)
- "Called to counter" message: eliminates the "I didn't hear my number" problem entirely

**Technical approach:** Use WhatsApp Business API (Meta Cloud API) or a provider like Twilio/MessageBird. Cost is ~$0.005-0.05 per message depending on region. For 400 clients/day × 4 messages each = ~1,600 messages/day = ~$8-80/day.

**Fallback:** SMS for clients without WhatsApp. Cost is higher ($0.01-0.05/SMS) but still trivial at this scale.

---

### 2.2 Pre-Arrival Mobile Check-in

Let clients check in from their phone **before they arrive at the office**. This is the pattern that hotel chains have perfected (73% of hotel guests prefer mobile check-in) and government offices are now adopting.

**Flow:**
```
T-2h WhatsApp: "Tap to check in now: https://mwo.sg/checkin/ABC12345"
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  Minimal mobile page │
                              │  (no app download)   │
                              │                      │
                              │  "MWO Singapore"     │
                              │  Your appointment:   │
                              │  31 Mar, 10:00 AM    │
                              │  Contract Verif.     │
                              │                      │
                              │  [Confirm Check-in]  │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              Supabase RPC: next_queue_number()
                              INSERT kiosk_checkins (WAITING)
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  "You're checked in!"│
                              │  Queue: 6015         │
                              │  Position: #8        │
                              │  Est. wait: ~20 min  │
                              │                      │
                              │  "Head to MWO when   │
                              │  your turn approaches.│
                              │  We'll notify you."  │
                              └─────────────────────┘
```

**Benefits:**
- **Zero check-in time at the office** — client walks in already queued
- **Crowd timing** — client can delay arrival until their turn is near
- **Kiosk load reduction** — fewer people need to scan at the physical kiosk
- **If they also scan at kiosk:** Duplicate check shows "Already checked in as Q#6015" (already implemented)

**Implementation:** This is a lightweight web page (can be a single Next.js page in AgencyHire or a standalone static page). It calls the same Supabase RPC and INSERT that the kiosk uses. The `appointment_type` would be `'APPOINTMENT'` and status `'WAITING'` — identical to a kiosk check-in.

---

### 2.3 Smart Queue Routing

**Current state:** "Call Next" picks the first WAITING entry in the staff's queue series, ordered by priority then queue number. Simple FIFO within priority tier.

**Recommendation — Three levels of routing intelligence:**

**Level 1 — Service-Type Aware Counters (implement first):**
Each counter declares which service types it handles. "Call Next" only pulls entries matching the counter's services.

```
Window 1: [SKILLED_CV, MDW_CV]     → Regular CV queue
Window 2: [SKILLED_CV, MDW_CV, DH] → Regular + Direct Hire
Window 3: [FRA_REGISTRATION]       → FRA only
Window 4: [ACCREDITATION]          → Accreditation only
Window 5: [OWWA]                   → OWWA only
```

This is partially implemented already (counters 1-7 for regular, 8-10 for OWWA), but not at the service-type level within the regular queue. A DH client and a CV client currently share the same queue, but DH processing takes longer.

**Level 2 — Dynamic Rebalancing Alerts:**
When one service queue exceeds a threshold (e.g., estimated wait > 30 min), the system alerts the supervisor:

> "CV queue wait time is 35 minutes (12 waiting, 2 active counters). FRA queue has 0 waiting. Consider reassigning Window 3 to CV."

This doesn't require automatic reassignment — just visibility. A dashboard widget on the admin/supervisor page.

**Level 3 — Predictive Staffing (future):**
Based on the day's appointment mix (already known from AgencyHire), pre-calculate the optimal counter assignment before the office opens:

> "Today: 45 CV appointments, 8 FRA batches, 15 OWWA. Recommended: 5 CV counters, 1 FRA, 2 OWWA."

---

### 2.4 Waitlist / Standby for No-Show Slots

When a client doesn't check in within 15 minutes of their appointment time, their slot effectively goes to waste.

**Recommendation:**
1. At T+15 minutes past appointment time, if the client hasn't checked in, mark the appointment as `no_show` in AgencyHire
2. If walk-in clients are waiting, the next walk-in is automatically promoted to appointment priority (priority 3 instead of 7)
3. Optionally: maintain a standby list. Walk-in clients can opt in to "notify me if a slot opens." When a no-show is detected, the first standby client gets a WhatsApp message: "A slot has opened! Reply YES within 5 minutes to claim it."

**Impact:** Fills 70-80% of no-show gaps without overbooking. No risk of overcrowding.

---

### 2.5 Capacity-Aware Booking in AgencyHire

**Current state:** AgencyHire books appointments based on slot capacity (time slots × max per slot). But it doesn't know the **real processing capacity** of the office — which depends on how many staff are available for each service type on any given day.

**Recommendation:** Feed real throughput data back to AgencyHire.

```
Nexus tracks: avg service time per type, staff count per type, daily throughput
                    │
                    ▼
AgencyHire adjusts: available slots = f(staff × hours / avg_service_time)
```

**Example:** If Wednesday typically has 3 CV processors and each handles 4 clients/hour, AgencyHire should cap CV slots at ~24 for the day (3 × 4 × 2 hours per session). Currently, slot capacity is a static number.

**Phase 1:** Manual — admin sets daily capacity per service in AgencyHire settings.
**Phase 2:** Semi-automatic — Nexus exposes a `/api/capacity` endpoint that AgencyHire reads weekly to suggest capacity adjustments.
**Phase 3:** Automatic — real-time capacity sync (only if needed; Phase 1 is usually sufficient).

---

## Tier 3 Recommendations — The No-Receptionist Future

### 3.1 Self-Service Walk-in Registration (Kiosk)

**The barrier:** Walk-ins currently require a receptionist to type in the client's name and select the service type. The kiosk has an on-screen keyboard but walk-in registration is disabled in kiosk mode.

**Solution — Progressive self-service:**

**Step 1: Phone number lookup.**
Before asking the client to type their name, ask for their phone number. If they've ever booked before (or if the agency has their contact), the system finds them:

```
Kiosk: "No appointment? Enter your phone number:"
       [+65] [9 1 2 3 4 5 6 7]
       
System: Found! "JUAN DELA CRUZ — previous MDW_CV appointment on 15 Mar"
        [Check in for CV?]  [Different service]
```

This eliminates manual name entry for ~60% of walk-ins (return visitors).

**Step 2: Minimal self-registration.**
For truly new clients, the kiosk collects only:
- Service type (large buttons: CV / OWWA / Direct Hire / FRA)
- Phone number (numeric keyboard — easy)
- First name + last name (on-screen QWERTY keyboard)

That's it. No email, no middle name, no employer. The processor fills in details when they serve the client. This keeps the kiosk interaction under 30 seconds.

**Step 3: QR-from-phone registration.**
New clients without appointments can scan a QR code posted in the waiting area that opens a mobile web form. They fill in their details on their own phone (native keyboard — much faster than on-screen), and the form creates a walk-in queue entry. This is faster than any kiosk keyboard.

### 3.2 "Call for Help" Escalation Button

In a no-receptionist environment, clients who are confused need a way to get help without wandering around.

**On the kiosk:** A persistent "Need Help?" button (bottom corner, always visible). When pressed:
1. Displays "A staff member has been notified. Please wait." on screen
2. Sends a notification to floor staff (via the Nexus dashboard or a mobile/watch notification)
3. Includes the kiosk location if multiple kiosks exist

**On the waiting area display:** A message: "Need assistance? Please approach Window 1."

### 3.3 Bilingual / Multi-Language Support

Your OFW clientele is primarily Filipino, but includes other nationalities. The kiosk and queue display should support at minimum English and Filipino, with a language toggle on the splash screen.

**Implementation:** Create a translation JSON file per language. All kiosk UI strings reference keys, not hardcoded English.

### 3.4 Appointment-from-Kiosk for Walk-ins

Instead of registering a walk-in for today, the kiosk could offer: "No appointment? Book one now for today or a future date."

This opens a simplified version of the AgencyHire booking flow right on the kiosk. The client selects a service, picks today (if slots available) or a future date, and gets an appointment with a queue number.

**Why:** This turns every walk-in into an appointment, which:
- Gives you better demand forecasting
- Reduces "wasted" walk-in slots (they get a real time slot)
- Trains clients to use the appointment system

---

## Innovation Ideas — Beyond Standard Queue Management

### I1. "Time to Leave" Calculator
On the pre-arrival check-in page, after the client checks in from their phone, show: "Based on current queue, your turn is in ~25 minutes. If you're X minutes away, leave at [time]."

Uses Google Maps API for travel time estimate from a configurable default location (e.g., MRT station nearest to the office).

### I2. Queue Analytics Dashboard (Supervisor)
A real-time dashboard for the office supervisor showing:
- Current queue depth by service type (with trend arrows)
- Staff utilization (% of time in PROCESSING vs idle)
- Bottleneck alerts (which service is falling behind)
- Today vs same-day-last-week comparison
- Predicted end-of-day: "At current pace, all clients served by 3:15 PM"

### I3. Document Readiness Check
During pre-arrival check-in (mobile), show a checklist of required documents based on service type:
- CV: Valid passport, employment contract, work permit
- DH: [eligibility docs]
- FRA: [agency docs]

Client checks off each item. If they're missing something, they see: "You may be deferred. Please bring [X] to avoid delays."

Reduces deferrals (which waste a queue slot and frustrate the client).

### I4. VIP / Accessibility Priority
Add a priority tier between appointments (3) and walk-ins (7):
- Priority 1: Accessibility (elderly, disabled, pregnant) — served first
- Priority 2: Time-sensitive (flight tomorrow, visa expiring)
- Priority 3: Standard appointment
- Priority 7: Walk-in

Receptionist (or kiosk with accessibility button) can assign priority 1-2. Requires a "reason" field for audit.

### I5. Post-Service Feedback
After OR issuance, the WhatsApp notification includes a one-tap satisfaction rating:

> "Your transaction is complete. How was your experience? Reply: 1 (Poor) 2 3 4 5 (Excellent)"

Aggregated daily, this gives you a Net Satisfaction Score with zero effort. Correlate with wait time data to prove that queue improvements work.

### I6. Appointment Density Heatmap
In AgencyHire's admin scheduler, show a visual heatmap of appointment density across the week:

```
       Mon    Tue    Wed    Thu    Fri
8-9    ████   ██     ███    █████  ████
9-10   █████  ████   ████   █████  █████
10-11  ███    ███    ██     ████   ███
11-12  ██     █      █      ██     ██
```

Red = near capacity, Green = plenty of room. Helps admins spot patterns and adjust slot availability proactively.

---

# PART 2: IMPLEMENTATION PLAN

---

## System Boundaries

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────────┐
│   AgencyHire    │      │   Supabase   │      │  Nexus Backend  │
│  (Booking site) │─────▶│  (Shared DB) │◀─────│  (LAN server)   │
│                 │      │              │      │                 │
│ Next.js 14      │      │ appointments │      │ NestJS 11       │
│ AWS SES email   │      │ kiosk_checkins│     │ PostgreSQL local │
│ reCAPTCHA       │      │ fra_regs     │      │ Prisma ORM      │
└─────────────────┘      │ services     │      └─────────────────┘
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │    Nexus Kiosk        │
                    │  (Standalone Electron) │
                    │  (Separate network)    │
                    └───────────────────────┘
```

**Rule:** Changes to one system should not break the others. All communication is through Supabase. No direct API calls between systems.

---

## Phase 1: Foundation Fixes + Quick Wins (Weeks 1-3)

### 1A. Nexus Backend — Fix Critical Issues

**1A.1 Consolidate kiosk listeners**
- File: `apps/backend/src/modules/supabase/supabase.service.ts`
- Action: Remove the `kiosk_checkins` INSERT subscription and polling logic from `SupabaseService.onModuleInit()`
- Keep only `KioskBridgeService` as the single processor for PENDING → WAITING
- Verify: One listener, zero race conditions

**1A.2 Reset call_count on reactivation**
- File: `apps/backend/src/modules/queue/queue.service.ts` (reactivation/re-enter handlers)
- Action: When changing status from DEFERRED/MISSED → WAITING, set `call_count = 0`
- Verify: Deferred client can be called 3 times after re-entry

**1A.3 Extract service type mapping**
- Create: `apps/backend/src/common/service-mapping.ts`
- Single `SERVICE_CONFIG` constant with slug → (series, serviceType, startNumber, displayPrefix)
- Import in: kiosk-bridge, supabase.service, queue.service, fra.service
- Also update Nexus Kiosk `constants.ts` to match (or read from Supabase `services` table)

**1A.4 Add Supabase realtime health check**
- File: `apps/backend/src/modules/supabase/supabase.service.ts`
- Action: Track last received realtime event timestamp. If > 60 seconds without any event, attempt reconnection. If reconnection fails, log warning + create admin notification.

### 1B. Nexus Kiosk — EWT on Success Screen

**1B.1 Add position + wait estimate to check-in result**
- File: `src/services/queue.service.ts` — after INSERT to kiosk_checkins
- Query: count WAITING entries in same series with lower queue_number for today
- Calculate: `position × 15 / activeCounters` (use 15 min default, refine in Phase 2)
- Return: `{ queueNumber, displayNumber, queueSeries, position, estimatedWaitMinutes }`

**1B.2 Display on success screen**
- File: `src/pages/kiosk/SuccessScreen.tsx`
- Add below queue number: "Position: #8 | Est. wait: ~20 min"
- File: `src/pages/receptionist/CheckinPanel.tsx`
- Add to last check-in display

**1B.3 Print on thermal ticket**
- File: `electron/ipc/print.ipc.ts` — update `buildReceiptHtml()`
- Add lines: position count and estimated wait below the service type line

### 1C. Nexus Frontend — Enhanced Queue Display

**1C.1 Add "Next Up" row**
- File: `apps/frontend/src/pages/QueueDisplayPage.tsx`
- Below the NOW SERVING section, show the next 5 WAITING entries across all series
- Query: Already available from the display endpoint; just needs UI rendering

**1C.2 Add stats bar**
- Show: Waiting count | Average wait | Served today
- Data: Extend `/queue/display` endpoint or use existing `/queue/ewt`

**1C.3 Add info banner**
- Pull from `announcements` table (active, priority >= INFO)
- Rotate every 10 seconds if multiple announcements exist
- Default: "Please have your documents ready before your number is called."

---

## Phase 2: Notification System + Pre-Arrival Check-in (Weeks 4-8)

### 2A. WhatsApp / SMS Notification Service

**2A.1 Create notification module in Nexus Backend**
- New module: `apps/backend/src/modules/notifications/`
- Files: `notification.service.ts`, `notification.controller.ts`, `notification.module.ts`
- Integrates with WhatsApp Business API (Meta Cloud API) or Twilio
- Template-based messages (WhatsApp requires pre-approved templates)
- Fallback to SMS if WhatsApp delivery fails

**2A.2 Notification triggers**

| Trigger | Source | Message |
|---------|--------|---------|
| Appointment booked | AgencyHire (webhook or Supabase trigger) | Confirmation + QR |
| T-24h before | Cron job in Nexus Backend | Reminder + cancel option |
| T-2h before | Cron job | Reminder + pre-check-in link |
| T-15m (not checked in) | Cron job | "Are you on your way?" |
| Checked in | Kiosk check-in (Supabase trigger) | Queue position + EWT |
| 3 positions away | Queue status change (Nexus Backend) | "Approaching" alert |
| Called to counter | Call Next action (Nexus Backend) | "Proceed to Window X" |

**2A.3 Supabase function trigger for check-in notification**
- Create Supabase Edge Function or database trigger
- On INSERT to `kiosk_checkins` with status WAITING, fire webhook to notification service
- Include: client_contact (from appointment), queue_number, display_number, position

**2A.4 Cron jobs for reminders**
- Scheduled task: every 15 minutes, scan `appointments` for upcoming appointments
- T-24h batch: send reminders for tomorrow's appointments
- T-2h batch: send reminders for appointments in next 2-3 hours
- T-15m batch: check if appointment holder has checked in; if not, send nudge
- Use `system_config` to store WhatsApp API credentials and enable/disable

**2A.5 "Approaching" and "Called" notifications**
- In `queue.service.ts`, after status change to CALLED:
  - Look up client_contact from kiosk_checkins → appointment → client_contact
  - Send "called to window" WhatsApp
- When entry moves to position 3 in queue:
  - Send "approaching" WhatsApp
- These are non-blocking (fire-and-forget). Queue operations must never wait on WhatsApp delivery.

### 2B. Pre-Arrival Mobile Check-in Page

**2B.1 Create check-in page in AgencyHire**
- New page: `app/checkin/[ref]/page.tsx`
- Minimal mobile-first design (no nav, no booking flow — just check-in)
- Shows: appointment details, service type, date/time
- Button: "Confirm Check-in"
- On confirm: call Supabase RPC `next_queue_number`, INSERT `kiosk_checkins` (same as kiosk app)
- Show: queue number, position, EWT
- Guard: only available within 30 minutes of appointment time (configurable)

**2B.2 Generate check-in link in notifications**
- The T-2h WhatsApp message includes: `https://[agencyhire-domain]/checkin/[ref_code]`
- The link is personalized (ref_code is unique per appointment)
- Page validates: appointment exists, status is confirmed/pending, date is today, within check-in window

**2B.3 Duplicate protection**
- Same logic as kiosk: check `kiosk_checkins` for existing entry with same ref_code + today
- If already checked in (from kiosk or previous mobile check-in), show existing queue number

### 2C. Improved EWT Calculation (Nexus Backend)

**2C.1 Weighted moving average**
- Replace flat average with 7-day weighted moving average
- Weights: today=7, yesterday=6, ..., 7 days ago=1
- Calculate per service type
- Store in `system_config` as cached values, recalculate hourly

**2C.2 Factor in active counter count**
- `estimatedWait = (position × avgServiceTime) / activeCountersForSeries`
- Use `counter` module's active assignments to determine activeCountersForSeries
- If no counters active (before office opens), show "Waiting for counters to open"

**2C.3 Expose EWT via API**
- Endpoint: `GET /queue/ewt?series=REGULAR` (already exists, enhance it)
- Returns: `{ avgServiceMinutes, activeCounters, waitingCount, estimatedWaitMinutes }`
- Used by: Kiosk (at check-in time), Queue Display (live), Mobile check-in page

---

## Phase 3: Smart Routing + Crowd Management (Weeks 9-12)

### 3A. Service-Type Aware Counter Assignment

**3A.1 Extend counter model**
- Add to counter assignment: `serviceTypes: string[]` (array of service types this counter handles)
- UI: Settings > Staff > Counter Assignment now includes a multi-select of service types
- Default: counters 1-7 handle all REGULAR types, 8-10 handle OWWA

**3A.2 Update "Call Next" logic**
- In `queue.service.ts` `callNext()`:
  - Get caller's counter assignment including serviceTypes
  - Filter WAITING entries to only those matching counter's serviceTypes
  - Within matches, sort by priority then queue_number (existing logic)
- This prevents a CV-only counter from pulling an accreditation case

### 3B. Supervisor Dashboard Widget

**3B.1 Queue health indicators**
- New component in Nexus frontend dashboard
- Shows per-service-type: waiting count, active counters, avg wait, trend (up/down arrow)
- Highlight in red if any service type has wait > 30 min
- Suggest: "FRA queue empty. Consider reassigning Window 3 to CV."

**3B.2 Staff utilization metrics**
- Per staff member: time in PROCESSING vs idle today
- Calculated from kiosk_checkins: sum of (completed_at - called_at) per assigned_to
- Show as simple percentage bar

### 3C. No-Show Detection + Walk-in Promotion

**3C.1 Auto no-show marking**
- Cron job (every 5 minutes): scan appointments where:
  - `appointment_date` = today
  - `start_time` < now - 15 minutes (SGT)
  - No matching `kiosk_checkins` entry for today
  - Status still `confirmed` or `pending`
- Mark as `no_show` in Supabase `appointments`
- Optionally notify client: "You missed your appointment. Please rebook."

**3C.2 Walk-in priority promotion**
- When a no-show is detected and walk-ins are waiting:
  - Promote the oldest walk-in (WALKIN_REGULAR) to priority 3 (from 7)
  - Send notification to that walk-in: "A slot has opened. You've been moved up in the queue."
- Configurable: enable/disable in `system_config`

---

## Phase 4: Self-Service Evolution (Weeks 13-20)

### 4A. Walk-in Self-Registration in Kiosk Mode

**4A.1 Phone number lookup path**
- Kiosk: new screen after "No Appointment" → "Enter your phone number"
- Query: search `appointments` by `client_contact` for any previous appointment (any date)
- If found: pre-fill name and last service type. "Check in as JUAN DELA CRUZ for CV?"
- If not found: proceed to minimal registration form

**4A.2 Minimal registration form (kiosk)**
- Service type: 5 large buttons (CV / OWWA / DH / FRA / Accreditation)
- Phone number: numeric on-screen keyboard (already implemented)
- First name + Last name: QWERTY on-screen keyboard (already implemented)
- Submit → walk-in queue entry (priority 7)
- Total interaction: ~20-30 seconds

**4A.3 QR-to-phone registration (waiting area)**
- Post a QR code in the waiting area: "Walk-in? Scan to register"
- QR opens: `https://[domain]/walkin`
- Mobile form: service type, phone, first/last name
- Client uses their own phone keyboard (much faster)
- Submits → walk-in queue entry

### 4B. "Call for Help" Button

**4B.1 Kiosk UI**
- Persistent button in bottom-left corner of all kiosk screens
- On press: full-screen message "A staff member has been notified. Please wait here."
- Auto-resets after 60 seconds

**4B.2 Staff notification**
- IPC or Supabase channel → Nexus dashboard shows alert: "Help requested at Kiosk 1"
- Optionally: push notification to floor staff's phone/watch

### 4C. Multi-Language Support

**4C.1 Translation framework**
- Create `src/lib/i18n/` with language JSON files: `en.json`, `fil.json`
- All UI strings reference keys: `t('kiosk.splash.title')` → "SCAN YOUR QR CODE" / "I-SCAN ANG QR CODE"
- Language toggle on kiosk splash screen (flag icons)
- Default: English. Remember last selection in electron-store.

---

## Phase 5: Analytics + Optimization (Ongoing)

### 5A. Post-Service Feedback (WhatsApp)

After transaction completion (OR_ISSUED status), send:
> "Your transaction is complete. How was your experience? Reply 1 (Poor) to 5 (Excellent)."

Log responses to a `feedback` table. Aggregate daily for Net Satisfaction Score.

### 5B. Queue Analytics Dashboard

- Daily throughput by service type (chart)
- Average wait time trend (7-day rolling)
- No-show rate trend
- Peak hour analysis (heatmap)
- Staff performance (transactions per hour, avg service time)

### 5C. Predictive Staffing

Based on historical appointment data + day-of-week patterns:
- Recommend counter assignments for tomorrow
- Alert if appointment volume exceeds predicted capacity
- Suggest booking slot reductions when staff is short

---

## Implementation Priority Matrix

| # | Feature | System | Impact | Effort | Phase |
|---|---------|--------|--------|--------|-------|
| 1 | Fix dual kiosk listeners | Nexus Backend | Critical (bug) | Low | 1 |
| 2 | Fix call_count reset | Nexus Backend | High (bug) | Low | 1 |
| 3 | EWT on ticket + success screen | Kiosk | Very High | Low | 1 |
| 4 | Enhanced queue display TV | Nexus Frontend | High | Medium | 1 |
| 5 | Extract service mapping | Nexus Backend | Medium | Low | 1 |
| 6 | Supabase health monitoring | Nexus Backend | Medium | Low | 1 |
| 7 | WhatsApp reminders (T-24h, T-2h) | New service | Very High | Medium | 2 |
| 8 | Pre-arrival mobile check-in | AgencyHire | Very High | Medium | 2 |
| 9 | "Called to counter" WhatsApp | Nexus Backend | High | Medium | 2 |
| 10 | Improved EWT (weighted avg) | Nexus Backend | Medium | Low | 2 |
| 11 | Service-type counter routing | Nexus Backend | High | Medium | 3 |
| 12 | Supervisor dashboard | Nexus Frontend | Medium | Medium | 3 |
| 13 | Auto no-show + walk-in promotion | Nexus Backend + AgencyHire | Medium | Medium | 3 |
| 14 | Walk-in self-registration (kiosk) | Kiosk | High | Medium | 4 |
| 15 | QR-to-phone walk-in registration | AgencyHire | High | Low | 4 |
| 16 | "Call for Help" button | Kiosk + Nexus | Medium | Low | 4 |
| 17 | Multi-language (EN/FIL) | Kiosk | Medium | Medium | 4 |
| 18 | Post-service feedback | Nexus Backend | Medium | Low | 5 |
| 19 | Queue analytics dashboard | Nexus Frontend | Medium | High | 5 |
| 20 | Predictive staffing | Nexus Backend | Medium | High | 5 |

---

## Supabase Schema Additions Required

### New columns on `kiosk_checkins`:
```sql
-- For WhatsApp notifications
client_contact    TEXT        -- phone number (copied from appointment at check-in)
notified_approaching BOOLEAN DEFAULT false  -- prevent duplicate "approaching" messages
notified_called   BOOLEAN DEFAULT false     -- prevent duplicate "called" messages
```

### New table: `notification_log`
```sql
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(id),
  checkin_id UUID,  -- FK to kiosk_checkins if applicable
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  template TEXT NOT NULL,  -- e.g., 'reminder_24h', 'called_to_counter'
  recipient TEXT NOT NULL,  -- phone number or email
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'failed', 'read')),
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: `feedback`
```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id UUID,
  appointment_id UUID,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  channel TEXT DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## AgencyHire Changes Required

| Change | File(s) | Phase |
|--------|---------|-------|
| New `/checkin/[ref]` page | `app/checkin/[ref]/page.tsx` | 2 |
| Check-in API (calls Supabase RPC) | `app/api/checkin/[ref]/route.ts` | 2 |
| WhatsApp webhook for reminders | `app/api/webhooks/notification/route.ts` | 2 |
| Include check-in link in confirmation email | `lib/email-templates/templates.ts` | 2 |
| Walk-in registration page | `app/walkin/page.tsx` | 4 |
| Capacity-aware booking (read Nexus throughput) | `lib/appointments/availability.ts` | 3 |
| No-show detection (cron or Supabase trigger) | New scheduled function | 3 |

---

## Key Design Principles

1. **Non-blocking notifications.** Queue operations must never wait on WhatsApp/SMS delivery. Notifications are fire-and-forget with async logging.
2. **Graceful degradation.** If WhatsApp API is down, the system works exactly as it does today. Notifications enhance but never gate the core flow.
3. **Single source of truth.** Queue state lives in Supabase `kiosk_checkins`. Notifications read from it; they never write to it.
4. **Privacy by default.** Client phone numbers are used only for appointment-related notifications. No marketing. No storage beyond the appointment lifecycle.
5. **Incremental delivery.** Each phase is independently valuable. Phase 1 alone delivers measurable improvement. You don't need Phase 5 for Phase 1 to matter.
