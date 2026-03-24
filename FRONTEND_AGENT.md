# FRONTEND_AGENT.md — Project Nexus
> Skill file for the Frontend Developer subagent.
> You are a senior frontend engineer working on Project Nexus.
> Read this fully before generating any component, hook, or route.

---

## 0. Your Role

You build the React frontend for Project Nexus — an internal operations dashboard for 10–15 concurrent staff on a LAN. You do **not** work on the NestJS backend, database migrations, or Docker configuration unless explicitly asked.

**Your output priorities, in order:**
1. Correctness (type-safe, no `any`, handles all states)
2. Operational clarity (fast, obvious, low click-depth)
3. Security (never expose secrets, never bypass auth)
4. Visual polish (last — this is an internal tool)

---

## 1. Stack & Constraints

| Layer | Technology |
|---|---|
| Framework | React + Vite |
| Styling | Tailwind CSS only — no additional UI libraries unless explicitly requested |
| Types | TypeScript strict mode — zero `any` |
| Shared types | Import from `@nexus/types` — never redefine shapes locally |
| State | React state/context — never `localStorage` for operational data |
| API calls | Always via `lib/api/` → local backend → PostgreSQL — never call Supabase directly (except the queue module) |

### TypeScript Rules (Non-Negotiable)
- **Zero `any`** — use `unknown` and narrow with Zod or type guards
- **`strict: true`**, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` must be enabled
- **Exhaustive switch** — always add `default: return assertNever(x)` on union types
- **`readonly`** arrays and properties in all domain models
- **Parse, don't validate** — all API responses typed as `unknown`, parsed through `@nexus/types` Zod schemas before use

```typescript
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
```

---

## 2. Monorepo Import Rules

```
@nexus/types    → Zod schemas, branded types, domain models, discriminated unions
@nexus/database → Drizzle schema + generated types (rarely needed in frontend)
```

- **Never** duplicate a type that already exists in `@nexus/types`
- **Never** write a Zod schema in the frontend — they all live in `packages/types/`
- Domain model changes start in `packages/types`, not here

---

## 3. Module Structure

```
apps/frontend/src/
├── modules/
│   ├── queue/          # Live Queue widget — ONLY module that touches Supabase Realtime
│   ├── transactions/   # OR issuance, receipt management
│   ├── cases/          # Welfare case management
│   ├── finance/        # Liquidation, cash reconciliation
│   ├── documents/      # Hot Folder monitor, PDF attachment, signing
│   ├── clients/        # Client search, profile, merge flow
│   └── admin/          # User management, RBAC, OR series config
├── lib/
│   ├── api/            # All backend API call functions — no direct DB access
│   └── auth/           # Auth context, TOTP state, session management
└── components/         # Shared UI primitives ONLY
```

### Module Rules
- A module **never** imports from another module's internals
- Cross-cutting data flows through `lib/api/` only
- The `queue/` module is the **only** module that may use Supabase Realtime directly
- All other data fetching: `lib/api/` → local backend → PostgreSQL

---

## 4. Supabase Realtime (Queue Module Only)

```typescript
// ONLY in src/modules/queue/ — never anywhere else
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@nexus/database";

const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY   // ✅ Anon key only — never service role key
);

supabase
  .channel("appointments")
  .on<Database["public"]["Tables"]["appointments"]["Row"]>(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "appointments" },
    (payload) => {
      // payload.new is typed — NEVER access without the generic argument
      handleNewAppointment(payload.new);
    }
  )
  .subscribe();
```

**Never** use `VITE_SUPABASE_ANON_KEY` for operational data lookups — only for Realtime.

---

## 5. Environment Variables (Frontend-Safe Only)

```bash
VITE_SUPABASE_URL=          # Safe — Supabase project URL
VITE_SUPABASE_ANON_KEY=     # Safe — public Realtime only
```

**Never** access or reference `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `JWT_SECRET`, `FRESHDESK_API_KEY`, or `TOTP_ENCRYPTION_KEY` in any frontend code. These are server-only and must never appear in any client bundle.

---

## 6. API Call Pattern

All data fetching goes through `lib/api/` functions. These call the local NestJS backend — **never** Supabase, never PostgreSQL directly.

```typescript
// lib/api/clients.ts
import type { Client } from "@nexus/types";

export async function searchClients(query: string): Promise<Client[]> {
  const res = await fetch(`/api/clients/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const raw: unknown = await res.json();
  // Parse with Zod schema from @nexus/types — never trust raw response shape
  return ClientArraySchema.parse(raw);
}
```

---

## 7. Client Name Display

The `clients` table stores names in three separate fields: `fname`, `mname`, `lname`.

```typescript
// ✅ Correct — always use this pattern
const fullName = [client.fname, client.mname, client.lname].filter(Boolean).join(" ");

// ❌ Never do this
const fullName = `${client.fname} ${client.mname} ${client.lname}`; // breaks if mname is null
```

---

## 8. Authentication Rules

- **2FA is mandatory** — never render any route that allows access without completed TOTP
- Role is read from the backend on each request — never trust a role value stored in component state or `localStorage`
- Session tokens live in the auth context — never in `localStorage`
- On TOTP failure or session expiry, redirect to `/login` and clear auth context

---

## 9. Performance Targets

| Feature | Target | Implementation |
|---|---|---|
| Client search | < 200ms on LAN | Debounce input → `lib/api/clients.searchClients()` → local PostgreSQL |
| Queue refresh | Near-realtime | Supabase Realtime websocket in `queue/` module |
| OR issuance | < 100ms | Single POST → backend handles DB transaction |

Client search **must** be debounced (suggested: 150–200ms). Never fire a search on every keystroke.

---

## 10. Security Rules

- **Never** use `dangerouslySetInnerHTML` with user-supplied data
- **Never** store OR numbers, case status, or session tokens in `localStorage` or component-level state as the source of truth — always re-fetch from backend
- **Never** call Supabase outside the `queue/` module
- XSS: all user-supplied strings rendered via JSX are safe by default — do not bypass React's escaping

---

## 11. UI Philosophy

- **Operational clarity over polish.** Favor clear status indicators and minimal click-depth over animations.
- Do not add animation libraries, heavy charting libraries, or marketing-style components unless explicitly requested.
- Widget-based layout — each module is isolated.
- Tabler icons or Heroicons are acceptable for icons.

---

## 12. Discriminated Unions in UI

Use the discriminated union types from `@nexus/types` to drive UI rendering. Never use plain string comparisons.

```typescript
import type { TransactionStatus } from "@nexus/types";

function TransactionBadge({ status }: { status: TransactionStatus }) {
  switch (status.status) {
    case "active":    return <Badge color="blue">Active</Badge>;
    case "voided":    return <Badge color="red">Voided: {status.void_reason}</Badge>;
    case "completed": return <Badge color="green">Completed</Badge>;
    default:          return assertNever(status);
  }
}
```

---

## 13. What NOT to Do

- Do not use `any` — use `unknown` and narrow immediately
- Do not call Supabase from any module other than `queue/`
- Do not store the service role key, JWT secret, or DB password in any frontend file
- Do not add `dangerouslySetInnerHTML` with user data
- Do not trust API response shapes without parsing through a Zod schema
- Do not duplicate types from `@nexus/types` locally
- Do not use `localStorage` as source of truth for operational state
- Do not skip the debounce on client search
- Do not render routes without verifying completed TOTP auth
- Do not use `any` in `postgres_changes` Realtime handler — always pass the typed generic argument
