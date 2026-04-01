# Kiosk Integration Review — Discrepancies & Actions

> Review of `NEXUS_INTEGRATION(1).md` against actual Nexus code.
> Date: 2026-04-01

## Bugs Fixed (from kiosk doc Section 17)

| Bug | Status | Fix Applied |
|-----|--------|-------------|
| BUG-1: call_count not reset on reactivation | **FIXED** | Added `call_count: 0, last_called_at: null` to all 3 reactivation paths |
| BUG-2: Dual kiosk listeners race condition | **FIXED** | Removed `subscribeToKioskCheckins()` and `processPendingKioskCheckins()` from supabase.service.ts |
| BUG-3: Service mapping duplication | ACKNOWLEDGED | 4+ locations still exist. Will consolidate in future refactor. |
| BUG-4: No realtime health monitoring | ACKNOWLEDGED | Low priority. 5s polling fallback mitigates. |

## Start Number Convention — NO FUNCTIONAL MISMATCH

| Series | Kiosk p_start_number | Nexus QUEUE_START_NUMBERS | First Number Generated |
|--------|---------------------|--------------------------|----------------------|
| REGULAR | 6001 | 6000 | **6001** (both) |
| OWWA | 9001 | 9000 | **9001** (both) |
| FRA | 1 | 0 | **1** (both) |
| WALKIN_REGULAR | 601 | 600 | **601** (both) |

The RPC does `MAX(queue_number, p_start_number - 1) + 1`. Both conventions produce identical first numbers. No action needed.

## OWWA Quick Queue — COMPATIBLE

- Kiosk writes OWWA quick queue with `queue_series: 'OWWA'` (not `WALKIN_OWWA`)
- Nexus `getWaitingQueue('OWWA')` now uses `.in(['OWWA', 'WALKIN_OWWA'])` so both are picked up
- Priority 7 (walk-in) is set correctly — OWWA appointments (priority 3) are called first

## OWWA service_type: 'OWWA' — NEEDS MONITORING

- Kiosk writes `service_type: 'OWWA'` for OWWA quick queue
- Prisma `ServiceType` enum does NOT include 'OWWA' — only SKILLED_CV, MDW_CV, DH, FRA_REGISTRATION, ACCREDITATION
- This only matters if Nexus tries to create a local transaction from an OWWA entry, which it doesn't — OWWA is queue-only (RECEIVED terminal state, no OR)
- The `service_type` column in kiosk_checkins is a free TEXT column (no constraint), so 'OWWA' is stored fine
- **No action needed** as long as OWWA stays queue-only

## Display Number Formatting — MINOR GAP

- Kiosk doc's `formatQueueDisplay` is missing `WALKIN_OWWA` and `WALKIN_FRA` cases
- Nexus's version in `packages/types/src/queue.ts` handles all 6 series
- The kiosk's walk-in entries use `WALKIN_REGULAR` (→ `W601`) which matches
- OWWA quick queue uses `OWWA` series (→ `9001`) which matches
- **No functional issue** — the missing cases in the doc are for series the kiosk doesn't use

## Security Findings from Audit

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 1 | `fra_registrations` has no RLS | HIGH | Need to enable RLS in Supabase |
| 2 | Service role key shared between backend + Electron | HIGH | Architectural — needs dedicated role in future |
| 3 | No server-side rate limit on queue number RPC | MEDIUM | Add MAX threshold alert to health endpoint |
| 4 | `.or()` string interpolation injection risk | MEDIUM | Need Zod validation on refCode inputs |
| 7 | Dual kiosk listeners | MEDIUM | **FIXED** |
| 8 | RLS policy leaks client_name/email to anon | MEDIUM | Create a view for public display reads |

## Recommendations for Kiosk App

1. **Match Nexus's `formatQueueDisplay` exactly** — copy the function from `packages/types/src/queue.ts` to handle all 6 series
2. **Store full ref_code** — never truncate (doc says this is already done ✓)
3. **OWWA quick queue is correct** using `OWWA` series — confirmed compatible with Nexus
4. **`appt_status = 'ARRIVED'` write is safe** — Nexus backend accepts this value
5. **Consider using anon key for reads** if RLS is enabled on all tables — reduces blast radius
