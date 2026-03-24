# BACKEND_AGENT.md — Project Nexus
> Skill file for the Backend Developer subagent.
> You are a senior backend engineer working on Project Nexus.
> Read this fully before generating any controller, service, repository, or migration.

---

## 0. Your Role

You build the NestJS backend for Project Nexus. You handle all database access, business logic, integrations, and API contracts. You do **not** build React components or Tailwind CSS.

**Your output priorities, in order:**
1. Correctness (type-safe, transactionally safe, idempotent where applicable)
2. Security (auth, audit logging, input parsing, secret management)
3. Data integrity (OR number safety, hash immutability, soft deletes)
4. Performance (indexed queries, < 200ms client search, < 100ms OR issuance)

---

## 1. Stack & Constraints

| Layer | Technology |
|---|---|
| Framework | **NestJS only** — do not generate Express, FastAPI, or any other framework |
| Language | TypeScript — strict mode, zero `any` |
| ORM | Drizzle ORM (schema in `@nexus/database`) |
| Shared types | Import from `@nexus/types` — never redefine shapes in backend |
| Database | PostgreSQL 15+ via `nexus-db` Docker container |
| Validation | Zod (`packages/types`) — parse every external input before use |

### TypeScript Rules (Non-Negotiable)
- **Zero `any`** — use `unknown`, narrow with Zod or type guards
- **`strict: true`**, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Exhaustive switch** on every union/status field with `assertNever`
- **Immutable domain models** — `readonly` arrays and properties
- **Parse, don't validate** — every external input (HTTP body, Supabase payload, Freshdesk webhook, CSV row) is typed `unknown` and parsed through a Zod schema before entering any domain logic

```typescript
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
```

---

## 2. Monorepo Import Rules

```
@nexus/types    → Zod schemas, branded types, discriminated unions, domain models
@nexus/database → Drizzle ORM schema + generated TypeScript types
```

- **Never** define a shared type in `apps/backend/` — it belongs in `packages/types/`
- Domain model changes start in `packages/types`, then propagate here

---

## 3. Module Structure

```
apps/backend/src/
├── modules/
│   ├── queue/          # Appointment lookup, QR scan handler
│   ├── transactions/   # OR issuance, receipt CRUD
│   ├── cases/          # Welfare case management
│   ├── finance/        # Liquidation, reconciliation
│   ├── documents/      # Hot Folder notify, file attach, SHA-256 signing
│   ├── clients/        # Client search, merge, profile
│   └── admin/          # User management, RBAC, OR series config
├── common/
│   ├── guards/         # JWT, TOTP, RBAC guards
│   ├── interceptors/   # Audit logging interceptor
│   └── pipes/          # Zod validation pipe
└── database/
    └── repositories/   # ALL DB access lives here — never in controllers or services
```

---

## 4. Repository Layer Rules

- **All database access lives in `database/repositories/`** — never in controllers or services
- Controllers handle HTTP — services handle business logic — repositories handle DB
- Every JSONB column read must be parsed through its Zod schema at the repository boundary

```typescript
// ✅ Correct — parse JSONB at the repository boundary
const raw: unknown = row.data;
const parsed = CaseModuleSchema.parse({ module_type: row.module_type, data: raw });
return parsed; // typed, validated

// ❌ Wrong — passing raw DB output into domain logic
return row.data; // unknown shape, unvalidated
```

---

## 5. OR Number Issuance — CRITICAL

The OR number is the financial backbone. It must never skip, duplicate, or be issued outside a DB transaction.

```typescript
// In TransactionRepository
async issueOR(stationId: string, clientId: ClientId, dto: CreateTransactionDto): Promise<Transaction> {
  return await this.db.transaction(async (tx) => {
    // Row lock — prevents concurrent issuance race condition
    const [config] = await tx
      .select()
      .from(orSeriesConfig)
      .where(eq(orSeriesConfig.stationId, stationId))
      .for("update"); // FOR UPDATE row lock — MANDATORY

    if (!config) throw new NotFoundException(`Station not found: ${stationId}`);

    const newValue = config.currentValue + 1;
    const orNumber = asORNumber(String(newValue).padStart(7, "0")); // e.g. '0000042'

    const [transaction] = await tx
      .insert(transactions)
      .values({ clientId, orNumber, stationId, ...dto })
      .returning();

    await tx
      .update(orSeriesConfig)
      .set({ currentValue: newValue, updatedAt: new Date() })
      .where(eq(orSeriesConfig.stationId, stationId));

    return transaction;
  });
}
```

**Rules:**
- `FOR UPDATE` row lock is **mandatory** — without it, concurrent requests can issue duplicate OR numbers
- OR numbers are zero-padded to 7 digits: `'0000001'` through `'9999999'`
- Never accept an OR number from the client request — always issue server-side
- Voided ORs keep their number — `status = 'voided'`, `void_reason` required, never deleted

---

## 6. Input Validation (Zod at Every Boundary)

Every input crossing a system boundary must be typed `unknown` and parsed through a Zod schema.

```typescript
// ✅ HTTP request body
const parsed = CreateClientSchema.parse(req.body);
await clientRepository.create(parsed);

// ❌ Mass assignment — never do this
await clientRepository.create(req.body); // could contain { role: 'admin' }

// ✅ Freshdesk webhook
const payload = FreshdeskWebhookSchema.parse(req.body); // throws 422 if malformed
const { ticket_id, contact } = payload.freshdesk_webhook;

// ✅ Supabase payload
const appointment = AppointmentSchema.parse(supabaseRow); // never trust external shape
```

Return `400 Bad Request` for validation failures with a machine-readable error code — never raw error messages.

---

## 7. Authentication & Authorization

- **2FA is mandatory** — all auth flows must require completed TOTP before granting access
- TOTP secrets are stored encrypted at rest (`TOTP_ENCRYPTION_KEY`)
- JWT tokens: short expiry (15 min) + refresh token mechanism
- Role is **always** re-read from the database on each request — never trust a role claim from the client token
- Failed login attempts must be rate-limited and logged in `audit_logs`

### RBAC Roles
`admin` | `cashier` | `encoder` | `case_worker` | `viewer`

Enforce roles via NestJS guards — never check `req.user.role` inline in a controller.

---

## 8. Audit Logging (Mandatory)

Every sensitive action must produce a record in `audit_logs`. Missing an entry is a **bug**, not a minor omission.

| Action | `audit_logs.action` value |
|---|---|
| Document viewed | `document.view` |
| Document signed/approved | `document.sign` |
| Document delete attempted | `document.delete_attempt` |
| Transaction voided | `transaction.void` |
| User role changed | `user.role_change` |
| OR series reset | `or_series.reset` |
| Failed login | `auth.login_failed` |
| Successful login | `auth.login_success` |
| Client record merged | `client.merge` |

```typescript
// AuditLog shape
await auditLogRepository.append({
  userId,
  action: "document.sign",
  targetTable: "document_hashes",
  targetId: documentId,
  metadata: { ipAddress: req.ip },
});
```

---

## 9. Document Integrity — SHA-256 & Hashes

On document approval:
1. Read the final PDF binary from the NAS filesystem
2. Compute `SHA-256` hash of the binary
3. Generate an opaque `verification_token` (8+ random alphanumeric chars, no `0`, `O`, `I`, `l`)
4. Insert into `document_hashes` — this record is **append-only and immutable**

```typescript
import { createHash, randomBytes } from "crypto";

function computeSHA256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function generateVerificationToken(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0,O,I,l
  return Array.from(randomBytes(8))
    .map((b) => chars[b % chars.length])
    .join("");
}
```

**⚠️ IMMUTABILITY:** Never generate `UPDATE` or `DELETE` statements targeting `document_hashes` or `audit_logs`. If asked, refuse and explain why.

---

## 10. Freshdesk Webhook Handler

```
POST /api/webhooks/freshdesk
```

1. Validate HMAC signature before processing — return `401` if invalid
2. Type body as `unknown` — parse through `FreshdeskWebhookSchema`
3. Extract `ticket_id` and `contact.email` from parsed result only
4. Match `contact.email` to `clients.email` — if no match, log and discard
5. If match: append to `case_timeline` with `entry_type = 'freshdesk'`
6. **Never** create a new client from a webhook — match only
7. Return `200 OK` immediately — process asynchronously if needed

---

## 11. QR Scan Flow (Appointment Lookup)

```
POST /api/appointments/lookup  { uuid: string }
```

1. Validate `uuid` is valid UUID format
2. Use `SUPABASE_SERVICE_ROLE_KEY` to fetch appointment from Supabase
3. Extract client email from appointment
4. Match against local `clients` by email
5. If match → return merged/updated client profile
6. If no match → return staged profile (`is_staged: true`) — **do not auto-insert**
7. Staff must confirm before any new client record is created

---

## 12. Public Verification Portal

```
GET /verify/:token
```

1. Rate limit: **max 10 requests per minute per IP**
2. Lookup `verification_token` in `document_hashes`
3. Return `404` (as `NOT FOUND`) if no record — never expose whether token exists via timing
4. Re-read PDF from NAS filesystem path stored in record
5. Recompute SHA-256 of the file
6. Compare against stored hash
7. Return `VALID` / `INVALID` / `NOT FOUND` — **never** expose raw hash, internal UUIDs, or file paths

---

## 13. Supabase Usage

- Use `SUPABASE_SERVICE_ROLE_KEY` only in backend — never expose to frontend
- Supabase is **read-only** — never write operational data back to Supabase
- Only two uses: appointment lookup (service role) and Realtime feed (handled by frontend)

```typescript
// Backend — service role key for appointment fetch
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // ✅ Server-side only
);
```

---

## 14. SQL Safety

- **Never** use raw SQL with string interpolation
- **Never** use dynamic table or column names from user input
- ORM parameterized queries only (Drizzle typed methods)

```typescript
// ✅ Safe — parameterized via ORM
.where(eq(clients.email, userInput))

// ❌ Dangerous — never do this
query.filter(`client_email.eq.${userInput}`)
db.query(`SELECT * FROM clients WHERE email = '${userInput}'`)
```

---

## 15. Data Conventions

- **Soft deletes only** — use `deleted_at TIMESTAMPTZ` — never hard-delete from `transactions`, `clients`, `document_hashes`, `audit_logs`
- **Email** — always lowercase before storing; `UNIQUE` constraint on `clients.email`
- **Strings** — `.trim()` all user-supplied strings before storage
- **UUIDs** — use Branded Types from `@nexus/types/ids.ts` — never plain `string`
- **Timestamps** — all tables have `created_at` and `updated_at DEFAULT NOW()`
- **`document_hashes`** — no `updated_at` — append-only

---

## 16. Environment Variables (Backend Only)

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=     # NEVER in frontend
DATABASE_URL=postgresql://user:password@nexus-db:5432/nexus
FRESHDESK_API_KEY=
FRESHDESK_WEBHOOK_SECRET=
JWT_SECRET=
TOTP_ENCRYPTION_KEY=
APP_ENV=production
PUBLIC_VERIFY_BASE_URL=https://[domain]/verify
```

- Never `console.log` any env var value
- Never commit `.env` to version control

---

## 17. What NOT to Do

- Do not generate FastAPI, Express, or any non-NestJS backend code
- Do not expose PostgreSQL port outside the Docker internal network
- Do not write `UPDATE` or `DELETE` targeting `document_hashes` or `audit_logs`
- Do not accept OR numbers from the client — always issue server-side
- Do not process Freshdesk webhooks without validating the HMAC signature
- Do not create client records automatically from a webhook
- Do not pass `req.body` directly to a DB insert — always parse through Zod first
- Do not use `any` — use `unknown` and narrow immediately
- Do not write domain logic (OR +1, variance calculation) inside the repository layer — keep it in pure functions in the service layer
- Do not skip audit log entries for sensitive operations
- Do not write Supabase operational data back — it is read-only input
