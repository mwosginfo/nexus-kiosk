# AUDIT.md — Nexus Kiosk Audit Checklist

> Use this document to audit the kiosk app for correctness, security, and compatibility with the Nexus backend.
> Run through this checklist after any significant change to check-in logic, queue number generation, or Supabase operations.

---

## 1. Architecture Constraints

```
┌─── Nexus Kiosk (Standalone Electron App) ────────┐
│                                                    │
│  Scans QR → Lookup Supabase → Insert Queue Entry  │
│                                                    │
│  Reads:  appointments, fra_registrations, services │
│          (anon key + RLS)                          │
│                                                    │
│  Writes: kiosk_checkins (service role key)         │
│          fra_registrations (status update only)    │
│                                                    │
└──────────┬─────────────────────────────────────────┘
           │
     Supabase (shared with Nexus)
           │
┌──────────┴─────────────────────────────────────────┐
│  Nexus Backend (separate LAN)                      │
│                                                    │
│  Kiosk Bridge: detects PENDING → WAITING           │
│  Queue Service: callNext, process, OR issue        │
│  FRA Service: confirm, process, batch OR           │
└────────────────────────────────────────────────────┘
```

**This app ONLY does check-in. It does NOT:**
- Call clients to counters
- Process transactions or issue OR numbers
- Manage the queue display
- Connect to the Nexus backend API directly

---

## 2. Modes of Operation

### Receptionist Mode
- Staff scans client QR code via HID scanner
- Staff sees result on screen + decides to print ticket
- Manual ref code entry fallback when scanner fails
- Walk-in registration (name + service type)
- Appointment browsing by date + search

### Kiosk Mode
- Client scans own QR code on mounted terminal
- Auto-checks in and auto-prints ticket
- No staff interaction needed
- Large, clear queue number display (readable from 2m)
- Timeout/reset after each interaction (return to splash)
- No walk-in registration (no keyboard for name entry)

---

## 3. Data Integrity Checks

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| A1 | `ref_code` stored as FULL value | 8 chars for appointments, 20-36 for FRA | Inspect `kiosk_checkins` rows after check-in |
| A2 | `transaction_ref` = full value | Never truncated | Same as A1 |
| A3 | `queue_number` from `next_queue_number()` RPC | Never MAX+1, never local count | Search code for queue number assignment |
| A4 | `display_number` matches `formatQueueDisplay()` | See DATABASE.md Section 7 | Compare screen output vs DB value |
| A5 | `queue_date` in SGT (not UTC) | `YYYY-MM-DD` via `todaySGT()` | Check at 11pm-1am SGT — must not be yesterday |
| A6 | `priority` = 3 (appointment/FRA), 7 (walk-in) | Never null or 0 | Inspect inserted rows |
| A7 | `call_count` initialized to 0 | Never null | Inspect inserted rows |
| A8 | `status` = `'WAITING'` (receptionist) or `'PENDING'` (kiosk) | Never blank | Check per mode |
| A9 | `appointment_type` matches scan type | `'APPOINTMENT'`, `'FRA'`, or `'WALKIN'` | CHECK constraint enforced by Supabase |
| A10 | `queue_series` matches service mapping | See DATABASE.md Section 4 | Cross-reference with service slug |
| A11 | `service_type` matches service mapping | Same | Same |
| A12 | `client_name` built correctly | No extra spaces, no "undefined", no "null" | Use `filter(Boolean).join(' ')` |
| A13 | `appointment_id` stored for appointments | UUID for appointments, NULL for FRA/walk-in | Inspect rows |
| A14 | Unique constraint respected | No duplicate `(queue_date, queue_number, queue_series)` | Check Supabase constraint |

---

## 4. Validation Logic Checks

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| B1 | Appointment date = today SGT | Reject past/future appointments | Test with yesterday's appointment |
| B2 | FRA date within past 14 days | Allow appointments up to 14 days old | Test with 15-day-old FRA |
| B3 | Appointment status check | Reject cancelled/completed/no_show | Test each status |
| B4 | FRA status check | Reject completed/cancelled | Test each status |
| B5 | Duplicate prevents double check-in | Show existing Q# for same ref_code + today | Scan same QR twice |
| B6 | Duplicate check excludes FAILED | FAILED entries can be retried | Manually set status to FAILED, re-scan |
| B7 | Service ID → slug resolves all 5+ services | skilled-cv, mdw-cv, dh, owwa, fra-registration, accreditation | Test each service type |
| B8 | Unknown service falls back gracefully | Default to DH/REGULAR, never crash | Test with fake service_id |

---

## 5. Error Handling Checks

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| C1 | No internet → clear message | "Cannot connect to server" | Disconnect network |
| C2 | Appointment not found → clear message | "No appointment found" | Scan invalid QR |
| C3 | Already checked in → show existing Q# | "Already checked in as Q#6001" | Scan same QR twice |
| C4 | Cancelled appointment → explain | "Appointment is cancelled" | Test with cancelled status |
| C5 | FRA not found within 14 days → explain | "No FRA registration found" | Scan old FRA ref |
| C6 | RPC fails → retry message | "Failed to generate queue number" | Mock RPC failure |
| C7 | Printer offline → still show Q# | Screen displays number even if print fails | Disconnect printer |
| C8 | Supabase rate limit → graceful retry | No raw error shown to user | Mock 429 response |

---

## 6. Security & Key Management

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| D1 | Anon key used for reads only | appointments, fra_registrations, services | Search code for `getSupabase()` calls |
| D2 | Service role key used for writes only | kiosk_checkins INSERT, fra_registrations UPDATE, RPC | Search code for `getSupabaseWriter()` calls |
| D3 | Service role key NOT in source code | In electron-store or env var only | `grep -r 'eyJ' src/` should return nothing |
| D4 | Service role key NOT in Vite bundle | Not in any `VITE_*` env var | Check `vite.config.ts` and `.env` for service key |
| D5 | No hardcoded Supabase URL/key in source | All from config | `grep -r 'supabase.co' src/` |
| D6 | RLS policy active on kiosk_checkins | Public read for display, service key for writes | Check Supabase dashboard |

---

## 7. Kiosk Mode Specific

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| E1 | No walk-in registration | No "Walk-in" button in kiosk mode | Visual inspection |
| E2 | Auto-reset after success | Returns to splash after ~5 seconds | Time the transition |
| E3 | Auto-reset after error | Returns to splash after ~5 seconds | Trigger error, time reset |
| E4 | Idle timeout | Resets to splash after 60s of no input | Wait and observe |
| E5 | Auto-print on success | Ticket prints without interaction | Test with printer connected |
| E6 | Large queue number display | Readable from 2 meters | Stand back and read |
| E7 | "See receptionist" on errors | Shown on all error screens | Trigger each error type |
| E8 | Locked interface | No address bar, no back, no menu bar, no dev tools | Try to escape kiosk UI |

---

## 8. Receptionist Mode Specific

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| F1 | Manual ref_code entry available | Input field accepts keyboard typing | Type a ref code manually |
| F2 | Walk-in registration available | Modal with service type + name fields | Click "Walk-in" button |
| F3 | Walk-in uses WALKIN_* series | Not REGULAR series; priority 7 | Inspect inserted row |
| F4 | Print toggle available | Staff can choose to print or not | Toggle setting, check behavior |
| F5 | Paper width setting persisted | 58mm/80mm saved in electron-store | Change, restart, verify |
| F6 | Today's check-in history visible | Recent check-in banner shows last entry | Check after check-in |
| F7 | Stats visible | Checked in / Waiting / Served counts | Visual inspection |
| F8 | Date browsing works | Can browse other dates' appointments | Change date picker |
| F9 | Search works | Name, email, phone search filters | Type search queries |

---

## 9. Nexus Backend Compatibility

| # | Check | Expected | How to Verify |
|---|-------|----------|---------------|
| G1 | Entries appear on Nexus Live Window | Within 10 seconds of check-in | Check-in on kiosk, watch Nexus |
| G2 | Entries appear on Queue Display TV | Within 3 seconds of being CALLED | Check-in, then call from Nexus |
| G3 | FRA entries appear on Agency Hire page | Grouped by transaction_ref | Check-in FRA, check Nexus Agency Hire |
| G4 | Queue numbers match | Same number on ticket and Nexus Live Window | Compare visually |
| G5 | Prefix matching handles full refs | Nexus can find entries via prefix match | Check Nexus lookup code |
| G6 | OWWA entries route correctly | OWWA queue, not REGULAR | Check-in OWWA, verify on Nexus OWWA page |
| G7 | Priority ordering works | Appointments (3) called before walk-ins (7) | Walk-in + appointment, check call order |
| G8 | Call count starts at 0 | Increments correctly on Nexus side | Check-in, call from Nexus |
| G9 | Deferred re-check-in works | Nexus defers → kiosk can re-check-in | Defer on Nexus, re-scan on kiosk |
| G10 | Multiple kiosks concurrent | RPC advisory lock prevents duplicates | Two kiosks check in simultaneously |

---

## 10. Timezone Edge Cases

| # | Scenario | Expected | Risk |
|---|----------|----------|------|
| T1 | Check-in at 11:55 PM SGT | queue_date = today SGT | UTC is already tomorrow |
| T2 | Check-in at 12:05 AM SGT | queue_date = new day SGT | New queue number series starts |
| T3 | Server timezone differs | App uses SGT calculation, not system TZ | todaySGT() must use UTC+8 offset |
| T4 | Appointment date stored as UTC in Supabase | Compare as DATE only (ignore time) | Strip time before comparison |

---

## 11. Performance Benchmarks

| Operation | Target | Measurement |
|-----------|--------|-------------|
| QR scan → queue number displayed | < 3 seconds | End-to-end from scan to success screen |
| Supabase read (appointment lookup) | < 1 second | Network round-trip |
| RPC (queue number generation) | < 500ms | Including advisory lock |
| Supabase write (kiosk_checkins insert) | < 1 second | Network round-trip |
| Ticket print | < 2 seconds | From IPC call to paper out |

---

## 12. Audit Execution Guide

### Quick Audit (After Bug Fix)
Run: A1-A5, B1-B5, C1-C3, D1-D2

### Full Audit (After Feature Change)
Run: All A checks, all B checks, all C checks, D1-D6, mode-specific (E or F), G1-G4

### Release Audit (Before Distribution)
Run: All checks in all sections. Both modes. Cross-verify with running Nexus instance.
