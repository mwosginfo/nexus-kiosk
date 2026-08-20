# Conformance record — Qtech integration response (5 August 2026)

Clause-by-clause mapping of the document to this implementation. Intended as
the working record for their Phase 1 (interface conformance) and Phase 5
(acceptance sign-off).

Status key: **Met** · **Partial** · **Confirm** (needs a decision from Qtech or
MWO) · **Deploy** (satisfied by deployment, not code) · **N/A**.

---

## §1 Interface definition

| Requirement | Status | Where |
|---|---|---|
| HTTPS REST, JSON, synchronous | Met | `src/qtech/client.ts` |
| Base URL `https://<tenant>.qtechqms.com/api/v1/ops` | Met | `QTECH_BASE_URL`; `/call` and `/health` appended |
| `POST /call` | Met | `QtechClient.call` |
| `GET /health` | Met | `QtechClient.health`, probed every 120s |
| `eventId` — UUID, unique per message | Met | UUIDv5, validated by `CallRequestSchema` |
| `ticketID` — unique per ticket, never reused, ≤64 chars | Met | `kiosk_checkins.id` (UUID, 36 chars); `.max(64)` enforced |
| `branchUUID` — required | Met | `QTECH_BRANCH_UUID` |
| `counterName` — required | Met | Blocked locally if absent rather than sent invalid |
| `queueNo` — required | Met | `display_number`, else formatted from series |
| `silent` — optional | Met | Sent only for the boot resync; omitted otherwise |
| `timestamp` — required, advisory | Met | Normalised to a canonical ISO instant |
| Success response parsing | Met | `src/qtech/schemas.ts` |
| Error codes `BRANCH_NOT_FOUND` / `COUNTER_UNKNOWN` / `VALIDATION_ERROR` | Met | `extractErrorCode`, lenient on envelope shape |

**`eventId` vs `ticketID`** — the document warns these are easy to conflate.
They are structurally separable here: `ticketID` is the row id and changes
never; `eventId` is derived from `(ticketID, call signature)` and changes on
every distinct call. Neither can drift into the other's role.

## §2 Event model

| Requirement | Status | Notes |
|---|---|---|
| Call is the only event | Met | Nothing else is sent. Missed / deferred / completed stay inside Nexus |
| A recall re-announces, with a new `eventId` | Met | A recall changes the signature, so a different key is derived |
| A reused `eventId` is a retry and is suppressed | Met | Derivation is deterministic, so retries reuse the key by construction |
| Voice needs numeric counter names | Met | Default format is `"7"`; the allow-list is numeric |
| The last number stays on screen indefinitely | Confirm | No clear instruction exists. MWO must accept that the wall holds overnight |

## §3 Authentication and transport security

| Requirement | Status | Notes |
|---|---|---|
| HTTPS only, TLS 1.2+ | Met | Config rejects `http://` outright (loopback exempt for tests). Node's minimum is TLS 1.2 |
| Certificate validation enabled | Met | Node default; the bridge additionally **refuses to start** if `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| HTTP Basic over TLS | Met | `src/qtech/client.ts` |
| Mutual TLS | N/A | Out of scope per the document |
| Secret not in source or VCS; replaceable without a code change | Met | `EnvironmentFile=/etc/nexus-qtech-bridge.env`, `0640 root:qtechbridge` |
| Rotation with a 7-day overlap | Met | A rotation is a file edit plus `systemctl restart` |
| IP allow-listing | Deploy | Egress address to be disclosed if adopted |

## §4 Delivery and failure handling

| Requirement | Status | Notes |
|---|---|---|
| 10s client timeout | Met | `QTECH_TIMEOUT_MS`, default 10000 |
| Retry on network failure / timeout / 5xx / 429 | Met | Tested for 500 and 429 |
| Never retry a business error | Met | Tested for all three codes, plus 401 → `AUTH_FAILED` |
| Backoff 1s / 2s / 4s, max 3 attempts, then log and stop | **Confirm** | See below |
| Duplicate returns `duplicate: true`, no re-announce | Met | Recorded as `DUPLICATE`, treated as delivered |
| Serialise calls per counter | Met | One request in flight per counter, strict FIFO; tested |
| No reconciliation or catch-up feed needed | Met | None implemented against Qtech |

**Attempt-count ambiguity.** "Exponential backoff at 1s / 2s / 4s, maximum 3
attempts" admits two readings: three attempts total (two gaps — 1s, 2s), or an
initial attempt plus three retries (three gaps — 1s, 2s, 4s). This
implementation takes the literal reading — **3 attempts, gaps of 1s and 2s** —
which is the more conservative of the two. The 4s step is present in the table
so raising the cap needs no other change. Worth one line of confirmation from
Qtech at Phase 1.

**Retry latency at a busy counter.** A failing call holds its counter's queue
for up to ~33s (3 attempts × 10s timeout + 3s of backoff). Calls behind it are
delivered in order afterwards, so the display settles correctly, but the
announcements lag. This is the cost of the serialisation §4 requires; flagging
it as an operating characteristic rather than a defect.

## §6 Minimum data set

| Requirement | Status | Notes |
|---|---|---|
| All six required fields sent | Met | Asserted as an exact key set in the delivery tests |
| No personal data | Met | The row is projected at the boundary; `client_name` / `client_email` / `ref_code` are never held, logged, or forwarded |
| `ticketID` opaque, encodes no personal data | Met | A UUID primary key |
| Series need not be a separate field | Met | Carried in `queueNo` (the `A` in `A004`) |
| No `status` field required | Met | Not sent |

## §7 Changes required on the MWO-OWWA system

| # | Requirement | Status |
|---|---|---|
| 1 | Outbound HTTPS client, TLS 1.2+, certificate validation | Met |
| 2 | Credential in a secret store, replaceable without a code change | Met |
| 3 | Emit a call whenever a number is called; recall re-sends with a new `eventId` | Met |
| 4 | Send MWO-OWWA's own counter label; match the agreed list; notify before adding | Met — unknown counters are blocked locally and recorded |
| 5 | One idempotency key per call, reused across retries | Met — derived, so it survives a process restart mid-retry |
| 6 | `ticketID` unique for the operating day, never reused, opaque | Met |
| 7 | Retry and backoff per §4, including the no-retry rule | Met, subject to the attempt-count confirmation above |
| 8 | Per-counter serialisation | Met |
| 9 | Error logging **and an operator-visible alert** after the final retry | **Partial** — see below |
| 10 | Egress IP disclosure | Deploy |
| 11 | Firewall rule for outbound 443 | Deploy |

**Item 9 is the one genuine gap.** The detection and recording half is
complete: a call abandoned after its final retry is logged at error level,
written to `qtech_call_log`, and moves the health row to `DEGRADED`, which
Nexus can read from `qtech_bridge_status`. What does not exist yet is the
*operator-visible* half — a badge or banner in the Nexus UI telling counter
staff the display may be stale. That is a Nexus-side change and is outside this
repo. Until it is built, item 9 is satisfied mechanically but not
operationally, and should not be signed off at Phase 5 on the strength of this
component alone.

## §8 Testing and acceptance

| Phase | Readiness |
|---|---|
| 0 — Environment (Qtech) | Awaiting test `branchUUID` and credentials |
| 1 — Interface conformance | `npm test` covers happy path, all three error codes, 401, 429, 5xx, duplicate, and the exact payload key set. Point `QTECH_BASE_URL` at the test branch to exercise it live |
| 2 — End-to-end display | Requires a connected display. `DRY_RUN=false` against the test branch |
| 3 — Failure injection | Duplicate replay, link severed, link restored, malformed and unauthenticated requests are all covered by existing behaviour; the health row is the evidence trail |
| 4 — Pilot (5 business days) | `qtech_call_log` provides the daily call-volume and error-rate review the phase asks for |
| 5 — Acceptance | Blocked on item 9's UI half |

## Open questions

**Qtech**

1. Attempt-count reading in §4 — 3 attempts total, or 3 retries after the first?
2. Which `queueNo` prefixes have recorded audio? We emit `A…`, `W…`, `WA…` and
   bare four-digit numbers; only `A045` appears in the document.
3. Exact `counterName` strings for the agreed list — `"7"` or `"Counter 7"`.
4. Does `GET /health` need the branch identified? "Liveness + branch resolution
   check" suggests it might take `branchUUID`; the bridge currently sends a
   bare authenticated GET.
5. Is a `silent: true` call at bridge startup an acceptable way to restore wall
   state? There is no clear or refresh instruction, so this uses `/call` with
   the documented `silent` flag for a purpose the document does not describe.
6. Rate limits behind the documented 429.

**MWO**

1. The wall never clears — confirm that is acceptable operationally.
2. Where the `qtech_bridge_status` badge should appear in Nexus (item 9).
3. Which counter runs the Phase 4 pilot.
4. Fixed public egress IP, if allow-listing is adopted.
