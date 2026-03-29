# Off-Limits Folders and Files
Claude must never read, edit, delete, move, or reference the contents of the following paths under any circumstances — even if explicitly asked.
Restricted Folders
/secrets/
/config/private/
/.env*               # All .env files and variants (e.g. .env.local, .env.production)
/credentials/
/private/
/admin/
/logs/
/backups/
/infra/
/.ssh/
/.aws/
/.gcp/
# Restricted Files
*.pem                # Private keys / certificates
*.key                # Key files
*.pfx                # Certificate bundles
secrets.json
credentials.json
service-account.json
*.secret
shadow
passwd
id_rsa / id_ed25519  # SSH private keys

# Behavior Rules

Do not read any restricted file, even to summarize or "just check" its contents.
Do not infer or reconstruct secrets from surrounding context, variable names, or comments.
Do not write secrets into any file, log, or output — even as placeholders.
If a task requires accessing a restricted path, stop and ask the user how to proceed instead of working around the restriction.
If unsure whether a file or folder is restricted, ask before accessing it.

# Revision, upscaling and Troubleshooting
When fixing a module, make sure to only access the module related to the request.
If there are modules that has to be accessed from outside, show the apis, workflow that might be affected.
DO NOT REVISE other files not connected to the module, unless explicity requested.

# Cross-Project Read Access — AgencyHire

Claude may **read (peek)** files in `c:\dbmwosg\agencyhire` and `c:\dbmwosg\nexus` for cross-reference purposes only. This is the upstream appointment booking system whose data flows into Nexus via Supabase.

**Allowed:** Read files to verify constants, IDs, enum values, data shapes, and API contracts — ensuring Nexus correctly receives and processes appointment data.
**Not allowed:** Edit, create, delete, or move any file in the AgencyHire project. Do not write code changes to AgencyHire from the Nexus workspace.

### Key AgencyHire files to cross-reference:
| File | What to check |
|---|---|
| `lib/supabase/types.ts` | Appointment, FraRegistration, Service, WeeklySlot type definitions — field names and types that arrive in Nexus |
| `lib/pra-data.js` | PRA agency lists (land-based ~826, sea-based ~380) — must match Nexus `Pra` records |
| `lib/appointments/validations.ts` | Booking rules, status transitions, cutoff logic |
| `lib/timezone.ts` | SGT (UTC+8) timezone handling — Nexus must parse dates consistently |
| `app/api/staff/appointments/[id]/route.ts` | Staff status update logic, Google Sheets triggers — understand what happens before data reaches Nexus |
| `app/api/staff/fra/[ref]/route.ts` | FRA registration status transitions and worker data shape |
| `app/api/appointments/route.ts` | Appointment creation payload — the shape of data entering Supabase |

# CLAUDE.md — Nexus Kiosk (Standalone Check-in Bridge)
> This file is the authoritative context document for AI coding assistants working on this codebase.
> Read this fully before generating any code, schema, or migration.
>
> **Scope:** This is a standalone Electron app (`nexus-kiosk`), NOT the Nexus monorepo.
> It serves as a **bridge** between Supabase appointments and the Nexus backend's local PostgreSQL queue system.
> The kiosk's duty: find appointments for arriving clients and provide them queue numbers.
>
> **Two modes:** Receptionist (staff-assisted) or Kiosk (self-service touchscreen).
> **Connectivity:** Can operate on LAN (direct Nexus API) or externally (Supabase bridge with Realtime).

---

## 0. AI Assistant Workflow Rules

These rules apply to every task in this project, without exception.

### Before Writing Code
1. **Always PLAN first.** State the approach, identify affected files/tables/components, and flag any ambiguities before generating any code.
2. **Check this CLAUDE.md** for relevant constraints before implementing anything.
3. Write detailed specs and remove ambiguity before starting — specificity improves autonomy and reduces rework.

### After Writing Code
4. **Re-check this CLAUDE.md** against what was just written. If the generated code drifts from the rules here (schema, security, naming, logic), apply corrections immediately.
5. If a fix is mediocre, do not patch it further — scrap it and implement the elegant solution using what was learned.
6. **Update documentation.** After every feature or module change, update the relevant sections in `CLAUDE.md` (architecture, endpoints, schema) and `WORKFLOWS.md` (user-facing workflows). Documentation must stay in sync with the code at all times.

### TypeScript Directives
These apply to every file generated in this project. There are no exceptions.

1. **Zero `any`:** Never use `any`. Use `unknown` for truly dynamic types and narrow it immediately with a Zod parse or type guard.
2. **Exhaustive checks:** When switching on status strings or union types, always add a `default` case with an exhaustive `never` check so the compiler errors if a new variant is added without handling it.
   ```typescript
   function assertNever(x: never): never {
     throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
   }
   // In switch: default: return assertNever(status);
   ```
3. **Immutability:** Prefer `readonly` arrays and properties in all domain models. Never mutate shared state.
4. **Functional core, imperative shell:** Keep database queries and side effects at the edges. Core logic (OR +1 calculation, variance, case status transitions) must be pure functions — easily testable without a DB connection.
5. **Parse, don't validate:** Every external input (HTTP request body, Supabase payload, Freshdesk webhook, CSV row) must be typed as `unknown` and parsed through a Zod schema before entering domain logic. Validation that merely checks fields is insufficient — the schema must transform and assert the full shape.

---

## 1. What This Project Is

**Project Nexus** is a local-first, unified operations and case management dashboard for an organization running 10–15 concurrent staff on a LAN. It replaces Glide, a fragmented Supabase frontend, and manual paper workflows.

It is **not** a public SaaS product. It is an internal operational tool. UI decisions must favor speed and clarity over aesthetics.

---

## 2. Infrastructure

| Layer | Technology |
|---|---|
| Host | Synology NAS via Docker (Container Manager) |
| Database | PostgreSQL 15+ |
| ORM | **Prisma 6** (schema in `packages/database/prisma/schema.prisma`) |
| Backend | **NestJS 11** (Node.js / TypeScript) |
| Frontend | React 19 + Vite 6 + Tailwind CSS 3.4 |
| Monorepo | Turborepo — shared types and schemas across apps |
| Realtime | Supabase Realtime (bookings feed) |
| Webhooks | Freshdesk (email/support integration) |
| Calendar | Google Calendar API (via `googleapis`) |
| Access (internal) | `http://nexus.local` via LAN |
| Access (external) | HTTPS only, via Synology Reverse Proxy on port 443 — public verification portal only |

### Monorepo Structure
```
├── packages/
│   ├── types/       # @nexus/types — Shared Zod schemas, enums, domain models
│   │   └── src/     # enums.ts, common.ts, auth.ts, client.ts, transaction.ts,
│   │                # attendance.ts, audit.ts, case.ts, accreditation.ts
│   └── database/    # @nexus/database — Prisma schema, migrations, seed, Prisma Client
│       └── prisma/  # schema.prisma, migrations/, seed.ts
├── apps/
│   ├── frontend/    # React + Vite (imports from @nexus/types)
│   └── backend/     # NestJS (imports from @nexus/types and @nexus/database)
```
- `@nexus/types` is the single source of truth for all shared shapes. No duplicated interfaces between frontend and backend.
- `@nexus/database` exports Prisma Client — all DB access goes through Prisma.
- The backend is **NestJS only**. Do not generate FastAPI, Express, or any other backend framework code for this project.

---

## 3. Database Schema (PostgreSQL via Prisma)

### 3.1 Core Registry
- `users` — Staff profiles, roles (`ADMIN`, `PROCESSOR`, `CASHIER`, `VIEWER`), bcrypt-hashed passwords, TOTP 2FA secrets
- `clients` — Master client registry; `email` is the **primary linking key** across all integrations
- `pra` — Philippine Recruitment Agency registry (integer PK `pra_id`)
- `attendance_logs` — HR time-in/time-out records with status tracking

### 3.2 Operations & Finance
- `transactions` — Linked to `client_id` and optionally `pra_id`; includes `service_type` enum, `trans_or` (7-digit VARCHAR), polymorphic fields per service type (VF, FRA, Accreditation)
- `or_series_config` — OR auto-increment configuration; single series shared across all service types, changed only when new booklets are issued
- `queue_entries` — Queue management with status tracking per service window
- `cash_denominations` — Daily cash denomination breakdown per processor and service type
- `print_log` — Receipt printing audit trail

### 3.3 Case Management
- `welfare_cases` — Multi-day, multi-transaction case records; `special_modules` JSONB field holds typed data for `PRISON`, `MEDICAL`, `MONITORING`, and `GENERAL` subtypes
- `case_timeline` — Unified feed: notes, Freshdesk threads, call logs, status changes, documents (append-only)

### 3.4 Integration & Audit
- `audit_logs` — Append-only log of all sensitive actions (includes `username`, `ip_address`, optional `transaction_id`)
- `document_hashes` — Immutable SHA-256 hash records for signed documents
- `freshdesk_status_log` — Append-only Freshdesk ticket status change log

### 3.5 Admin & System
- `system_config` — Key-value store for runtime-configurable settings (module access, calendar IDs). JSON `value` column, keyed by unique `key` string.
- `office_orders` — Office order documents with metadata (referenceNo, title, issueDate, category, filePath). File stored on NAS.
- `announcements` — Staff announcements with priority (`INFO`, `WARNING`, `URGENT`), active/inactive toggle, optional expiry date.

### Enums (Prisma)
| Enum | Values |
|---|---|
| `UserRole` | `ADMIN`, `PROCESSOR`, `CASHIER`, `VIEWER`, `OWWA` |
| `ServiceType` | `SKILLED_CV`, `MDW_CV`, `DH`, `FRA_REGISTRATION`, `ACCREDITATION` |
| `TransactionStatus` | `PENDING`, `PROCESSED`, `OR_ISSUED`, `COMPLETED`, `VOIDED` |
| `QueueStatus` | `WAITING`, `CALLED`, `PROCESSING`, `CONFIRMED`, `SUBMITTED`, `PROCESSED`, `OR_ISSUED`, `MISSED`, `DEFERRED`, `PENDING_SUBMISSION`, `RECEIVED` |
| `AttendanceStatus` | `ON_TIME`, `LATE`, `ABSENT`, `HALF_DAY` |
| `CaseType` | `PRISON`, `MEDICAL`, `MONITORING`, `GENERAL` |
| `CaseStatus` | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED` |
| `TimelineEntryType` | `NOTE`, `FRESHDESK_THREAD`, `CALL_LOG`, `STATUS_CHANGE`, `DOCUMENT` |

### Schema Rules
- Always use `UUID` as primary keys unless there is an explicit domain reason to use integers (e.g., `Pra` uses integer `pra_id`).
- `email` fields must have a `UNIQUE` constraint on the `clients` table.
- `trans_or` must be stored as a zero-padded 7-digit string (`VARCHAR(7)`). It must **never** skip, duplicate, or reset without an explicit admin action.
- JSONB columns (`special_modules`, `metadata`) must have a corresponding Zod runtime schema. Do not leave JSONB untyped.
- All tables must include `created_at` and `updated_at` timestamps (except append-only tables: `audit_logs`, `case_timeline`, `freshdesk_status_log`, `document_hashes` — which have `created_at` only).
- Every write that touches a document (view, edit, sign) must produce a record in `audit_logs`.
- **Timezone rule:** All date-only comparisons (queue date, transaction date, report filters) must use **SGT (UTC+8)**. Use the helpers in `common/sgt-date.ts` (`toSgtDateOnly`, `sgtTodayString`, `sgtDateToUtcRange`, `sgtComponents`). Never use `new Date().setHours(0,0,0,0)` or `new Date().toISOString().split('T')[0]` for date queries — these produce UTC dates which are wrong in SGT.

---

## 4. Domain Logic Rules

### 4.1 OR (Official Receipt) Series — CRITICAL
- The OR number is a **7-digit, auto-incrementing integer** stored in `trans_or`.
- **Single series**: All service types share the same OR number sequence. There is no per-service-type or per-station split — every transaction that reaches the Receipt page gets the next number in the single series.
- The series only changes when **new booklets are provided** (admin action via "Change Series"). There are no distinct series to track otherwise.
- The increment logic (`+1`) must be handled with a **database-level transaction and row lock** on `or_series_config` to prevent race conditions across concurrent users.
- No application-layer UUID or random generation is acceptable for OR numbers.
- OR number sequences must **never skip**. If a transaction is voided, the OR number is marked `VOIDED` — it is not reused and not skipped silently.

### 4.2 Zero-Entry Front Desk (QR Scan Flow)
1. Staff scans client's appointment QR code (HID scanner → keyboard emulation → input field).
2. System fetches UUID from Supabase using the scanned value.
3. Match attempt against local `clients` table **by email**.
4. If match found → merge/update local record.
5. If no match → stage a new client profile (do not auto-insert without staff confirmation).
6. No manual re-encoding of appointment data is permitted by design.

### 4.3 Hot Folder & File Automation
- The Synology "Hot Folder" is a watched directory path on the NAS.
- On file detection, the dashboard UI presents the file for staff to assign ("Attach to Transaction").
- Upon attachment, the system must:
  - Rename: `OR[7-digits]_[ClientLastName]_[YYYYMMDD].pdf`
  - Move to: `/Clients/{Year}/{ServiceType}/{RenamedFile}.pdf`
- Do not move or rename files before staff confirmation.

### 4.4 Digital Signature & Verification
- On document approval, compute a **SHA-256 hash** of the final PDF binary.
- Store the hash in the `document_hashes` table — this record is **immutable once written**. No UPDATE or DELETE is permitted on hash records.
- Overlay a QR code onto the PDF containing a unique verification token (not the raw hash).
- The public verification portal at `https://[domain]/verify/[token]` must:
  - Be fully read-only.
  - Recompute the hash of the stored file and compare against the database record.
  - Return a clear VALID / INVALID / NOT FOUND status.
- Never expose the raw SHA-256 hash or internal database IDs to the public portal response.

---

## 5. Security Non-Negotiables

- **2FA is mandatory** for all user roles. Do not generate any auth flow that bypasses TOTP.
- **All PII and document scans must remain on the local Synology NAS.** Do not write code that uploads client documents to any external cloud service.
- **Audit logging is not optional.** Every sensitive action (document open, sign, delete attempt, role change) must be logged.
- SHA-256 hash records are append-only. If asked to write an UPDATE or DELETE on hash records, refuse and explain why.
- Passwords must be hashed with `bcrypt` (min 12 rounds). Do not use MD5, SHA-1, or plain SHA-256 for password storage.
- The external HTTPS port (443) serves **only** the public verification portal. Internal dashboard routes must not be reachable from outside the LAN.

---

## 6. Frontend Rules

- Framework: **React 19 + Tailwind CSS 3.4**, bundled with **Vite 6**.
- UI philosophy: **Operational clarity over visual polish.** Prioritize low-latency client search (< 200ms target on LAN), clear status indicators, and minimal click-depth for common workflows.
- Do not add animation libraries, heavy charting libraries, or marketing-style UI components unless explicitly requested.
- Client search must be debounced and query the local PostgreSQL instance (not Supabase) for speed.
- Theme: CSS-variable-based light/dark mode, toggled via class `.dark` on `<html>`. Managed by `ThemeContext`.

### Frontend Structure
```
apps/frontend/src/
├── components/        # Shared UI (PlaceholderPage, AdminRoute, ErrorBoundary)
├── contexts/          # AuthContext, ThemeContext
├── layouts/           # DashboardLayout (sidebar, topbar, theme toggle)
├── lib/               # api.ts (backend API call functions), thermal-print.ts
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── AttendancePage.tsx
│   ├── QueueDisplayPage.tsx   # TV/monitor queue display (public, no auth)
│   ├── NotFoundPage.tsx       # 404 catch-all
│   ├── comms/         # Announcements, Calendar (FullCalendar), Office Orders
│   ├── services/      # Frontline: LiveWindow, ContractVerification,
│   │                  # AgencyHire, Receipt, Owwa, AccreditationProcessForm
│   ├── regulatory/    # Applications (Accreditation), DirectHire, SiteVisits,
│   │                  # Status*, Records*
│   ├── seabased/      # Records*
│   ├── reports/       # DailyReports*, MonthlyReports*, SPRs*
│   ├── kb/            # Info*, Resources*, Links*
│   ├── backend/       # Appointments, Checkin, Accre*
│   ├── hr/            # Contract*, Leaves*, Benefits*
│   ├── admin/         # Staff, ModuleAccess, Calendar, OfficeOrders,
│   │                  # Announcements, AuditLogs, Health
│   └── settings/      # StaffSettings (partial), Notifications*
└── index.css          # CSS variable theme system (light + dark mode)
# (* = placeholder, not yet implemented)
```

### Sidebar Navigation Groups
| Group | basePath | Roles | Pages |
|-------|----------|-------|-------|
| Dashboard | `/` | All | DashboardPage |
| Comms | `/comms` | All | Announcements, Calendar, Office Orders |
| Frontline | `/services` | ADMIN, PROCESSOR, CASHIER, OWWA | Live Window, Contract Verification, Agency Hire, Receipt, OWWA |
| Regulatory | `/regulatory` | ADMIN, PROCESSOR | Applications, Direct Hire, Site Visits, Status, Records |
| Seabased | `/seabased` | ADMIN, PROCESSOR | Records |
| Reports | `/reports` | All | Transactions (consolidated daily/monthly + generate report), SPRs |
| KB | `/kb` | All | Info, Resources, Links |
| Backend | `/backend` | ADMIN, PROCESSOR, OWWA | Appointments, Checkin, Accre |
| HR | `/hr` | All | Contract, Leaves, Attendance, Benefits |
| Admin | `/admin` | ADMIN only | Staff, Module Access, Calendar, Office Orders, Announcements, Audit Logs, System Health |
| Settings | `/settings` | All | Staff, Notifications |

### Error Handling
- **ErrorBoundary** (class component) wraps the entire app in `main.tsx`. Catches unhandled render errors and shows a generic "Something went wrong" page — no stack traces or code exposed.
- **NotFoundPage** — 404 catch-all for unmatched routes, rendered both inside and outside the dashboard layout.
- **AdminRoute** — Frontend guard component that redirects non-ADMIN users to `/`. Defense-in-depth (backend `@Roles('ADMIN')` is the real enforcement).

### Client Name Display Convention
The `clients` table stores names in three separate fields: `fname`, `mname`, `lname`.
- **Always** render full names using: `[fname, mname, lname].filter(Boolean).join(" ")`
- This handles missing middle names gracefully without extra conditionals.
- Never concatenate name fields manually or assume all three are present.

---

## 7. Backend Structure

```
apps/backend/src/
├── modules/
│   ├── prisma/            # PrismaService (DB connection)
│   ├── auth/              # JWT auth, TOTP, login
│   ├── users/             # User CRUD, role management, admin role/2FA/password ops
│   ├── clients/           # Client search, profile, merge
│   ├── transactions/      # Transaction CRUD, OR issuance, OR series management
│   ├── queue/             # Queue management, queue-linked transactions, appointments
│   ├── attendance/        # Staff time tracking
│   ├── audit/             # Audit log service (global)
│   ├── accreditation/     # Accreditation processing, site visits, interview scheduling, admin status changes
│   ├── counter/           # Staff-to-counter assignment for service windows
│   ├── dashboard/         # Dashboard aggregation (welfare stats, site visits)
│   ├── fra/               # FRA/Agency Hire registration, check-in, processing
│   ├── scans/             # Document scan upload, check, retrieval (WIP)
│   ├── admin/             # System config, module access, audit log viewer, health
│   ├── office-orders/     # Office order CRUD + file upload/download
│   ├── announcements/     # Announcement CRUD with active/inactive toggle
│   ├── supabase/          # Supabase client + config (read-only appointment source)
│   ├── freshdesk/         # Freshdesk API + webhook handling + ticket replies
│   └── google-calendar/   # Google Calendar integration
├── common/
│   ├── guards/            # JwtAuthGuard, RolesGuard
│   ├── decorators/        # @Roles() decorator
│   └── sgt-date.ts        # SGT (UTC+8) date utilities — shared across all modules
└── main.ts                # NestJS bootstrap (CORS, validation pipes, /api prefix)
```

### Dual Transaction Paths
- **`/api/transactions/*`** — Canonical transaction records with OR numbers. Source of truth for reports, OR series management (`getOrSeriesInfo`, `changeOrSeries`), void operations. Use this path for any reporting or OR-reference queries.
- **`/api/queue/transactions/*`** — Operational path during queue flow. Lists transactions by date/status, issues ORs during queue processing, handles receipt printing. Both paths share the same underlying database tables.

---

## 8. Integration Contracts

### Supabase — Appointments Schema (as of 2026-03)
The kiosk reads appointments and writes to `kiosk_checkins` (bridge table) and `fra_registrations`.

**Appointments table columns:**
```
id (uuid PK), ref_code (text UNIQUE), service_id (uuid FK → services),
slot_id (uuid nullable), appointment_date (date), start_time (time), end_time (time),
status (appointment_status enum: pending/confirmed/completed/cancelled/no_show),
client_email (text), client_contact (text nullable),
ofw_lname (text), ofw_fname (text nullable), ofw_mname (text nullable),
ofw_gender (text nullable), ofw_visa (text nullable),
ofw_position (text nullable), ofw_trans (text nullable),
p_name (text nullable),
client_data (jsonb, default {}), appt_status (text nullable),
staff_notes (text nullable),
confirmed_at, confirmed_by, completed_at, cancelled_at, cancel_reason,
created_at, updated_at
```
**Indexes:** appointment_date, service_id, status, ref_code, client_email.

**CRITICAL — Name field mapping:**
- **Appointment name fields:** `ofw_fname`, `ofw_lname`, `ofw_mname` (NOT `client_fname`/`client_lname`/`client_mname`).
- **OFW-specific fields:** `ofw_gender`, `ofw_visa`, `ofw_position`, `ofw_trans`, `client_contact`, `p_name` are **dedicated top-level columns**. Do NOT read these from `client_data` JSONB — they are promoted to columns.

**FRA registrations:** Read-write. Supabase CHECK constraint allows only: `pending`, `arrived`, `completed`, `cancelled`. Nexus-specific states (`deferred`, `removed`) are tracked via `staff_notes` tags (`[NEXUS:DEFERRED]`, `[NEXUS:REMOVED]`).

**Bridge table (`kiosk_checkins`):** Kiosk inserts (ref_code, appointment_type) → Nexus backend listens via Realtime, generates queue number, updates row → Kiosk receives event and prints ticket.

**Two connectivity modes:**
- **LAN (direct):** Kiosk calls Nexus API directly (`/queue/checkin`, `/fra/checkin`) — faster, no bridge table needed.
- **External (Supabase bridge):** Kiosk writes to `kiosk_checkins`, subscribes to Realtime, waits for Nexus to process (20s timeout + fallback poll).

All Supabase API calls use the **Publishable key** for reads. The **Service Role key** is used for writes (bridge inserts, marking arrived). Never expose the service role key in client-side bundles.

### Freshdesk
- Integrated via **webhooks** (inbound), API (for fetching thread history), and **ticket replies** (outbound, e.g., interview scheduling notifications).
- Freshdesk ticket threads are appended to `case_timeline` — they are never the source of truth for case status.
- Status changes logged in `freshdesk_status_log`.
- Freshdesk UI ticket links use `https://services.mwosingapore.online/a/tickets/[id]` (not the API domain).

### Google Calendar
- Google Calendar API via service account for MWO and OWWA calendars.
- Read/write integration managed by `google-calendar` backend module.

### Glide (Legacy)
- Glide data will be migrated via **CSV export**.
- Migration scripts must map Glide fields to `welfare_cases` and the `special_modules` JSONB field.
- Migration is a one-time, Phase 4 operation. Do not build ongoing Glide sync.

---

## 9. Implementation Phases (Reference)

| Phase | Focus |
|---|---|
| 1 | Docker + PostgreSQL on Synology; 2FA Auth; RBAC user roles |
| 2 | Supabase & Freshdesk bridges; Live Queue widget; QR scan logic |
| 3 | OR +1 logic; Hot Folder monitoring; file-rename automation |
| 4 | Glide CSV migration; JSONB case mapping; timeline unification |
| 5 | SHA-256 engine; PDF QR overlay; Public Verification Portal |

---

## 10. What NOT to Do

- Do not suggest cloud database hosting for any client PII or documents.
- Do not generate OR numbers using UUIDs, timestamps, or random values.
- Do not write frontend code that fetches directly from Supabase for operational data — always go through the local backend API.
- Do not skip audit log entries for document-sensitive operations.
- Do not leave JSONB columns without a Zod runtime schema (a TypeScript interface alone is not sufficient).
- Do not generate UPDATE or DELETE statements targeting hash records or audit logs.
- Do not use `localStorage` or client-side state as the source of truth for OR numbers or case status.
- Do not use `any`. Ever. Use `unknown` and narrow it.
- Do not generate FastAPI or Python backend code — the backend is NestJS.
