# nexus-qtech-bridge

Forwards MWO-OWWA queue calls from Nexus to the Qtech queue display.

```
Nexus  ──►  Supabase (kiosk_checkins)  ──►  bridge  ──►  Qtech cloud  ──►  wall
                      ▲                        │
                      └──── health row ────────┘
                        (Nexus reads this)
```

The bridge runs on a Raspberry Pi. It connects to **Supabase and Qtech only** —
never to Nexus, in either direction. Nexus already writes call state into
Supabase for its own queue; the bridge reads that, and writes its own health
back to Supabase for Nexus to read.

> **Transport: TCP.** As of 2026-08-20 the Qtech endpoint is on the PE network
> and takes the same JSON over TCP rather than HTTPS. `QTECH_TRANSPORT=tcp` is
> the default; the HTTPS transport is retained as a fallback. One thing is
> still unconfirmed — how a message is framed on the stream — so all three
> plausible conventions are implemented and `QTECH_TCP_FRAMING` selects one.
> `docs/TCP-PROTOCOL.md` is the proposed specification, with a working
> reference server (`npm run stub`) and a scenario runner (`npm run demo`)
> so it can be exercised rather than only read. Remaining questions are in
> `docs/QTECH-TCP-QUESTIONS.md`.

## Scope

Implements exactly what the Qtech integration response (5 August 2026)
defines, and nothing else:

| Endpoint | Used for |
|---|---|
| `POST /call` | Every number called to a counter |
| `GET /health` | Periodic liveness probe |

**Call is the only event Qtech accepts.** There is no missed state, no
completed state, no clear instruction, and no control over how anything is
rendered. Missed, re-instate, deferred, EWT and every other queue feature stay
inside Nexus for staff, and are not represented here. The wall shows what Qtech
shows.

## How a call is detected

This is the part that carries the design, because **Nexus has two code paths
that both end at `kiosk_checkins.status='CALLED'`, and they touch different
columns.** Watching only one of them silently drops real calls.

| Path | Services | What it writes to Supabase |
|---|---|---|
| Pending (via `supabase_outbox`, 2s fast lane) | CV, DH, FRA, Accreditation | `status`, `counter_number`, `called_at` — **never** `call_count` or `last_called_at` |
| Legacy (direct write) | OWWA window | `status`, `called_at`, `last_called_at`, `call_count`, `assigned_to`, `counter_number` |
| Legacy recall (`recallEntry`) | OWWA window | **only** `last_called_at` + `call_count` — `status` and `called_at` never move |

So the bridge keys on a composite signature:

```
called_at | last_called_at | call_count | counter_number
```

A change in any of them, while the row is `CALLED`, is a call. That covers a
first call, a recall on either path, and a counter takeover (a genuine
re-announcement at the new counter). A watcher keyed on `called_at` alone would
be blind to every OWWA recall — there is a regression test for exactly that.

### Field mapping

| Qtech field | Source | Why |
|---|---|---|
| `ticketID` | `kiosk_checkins.id` (UUID) | Opaque, unique per ticket, never reused, carries no personal data — precisely their §6 requirement |
| `queueNo` | `display_number`, else formatted from `queue_number` + `queue_series` | Rendered exactly as staff see it: `6001`, `9011`, `A004`, `W601`, `WA01` |
| `counterName` | `counter_number` → `"7"` | Their voice is pre-recorded and only announces numeric counter names |
| `eventId` | UUIDv5 of `(ticketID, signature)` | Deterministic, so a retry — including a retry across a process restart — reuses the key and Qtech suppresses the duplicate, while a recall derives a different key and does re-announce |
| `branchUUID` | config | Issued by Qtech at onboarding |
| `timestamp` | `called_at` | Advisory / audit only on their side |

Nothing else is sent. `kiosk_checkins` also carries `client_name`,
`client_email` and `ref_code`; the row is projected at the boundary and those
fields are never held, logged, or forwarded.

### Delivery rules

- **Retry** on network failure, timeout, 5xx, 429 — backoff 1s / 2s, max 3
  attempts, then stop. Stopping is safe by their §4: the next call event
  supersedes the lost one, and there is no reconciliation feed to catch up on.
- **Never retry** a business error (`BRANCH_NOT_FOUND`, `COUNTER_UNKNOWN`,
  `VALIDATION_ERROR`) or a rejected credential. The outcome will not change.
- **Serialise per counter**, one request in flight each, so a stale call cannot
  overwrite a newer one at the same counter. Different counters run
  concurrently.

### Two inputs, deliberately overlapping

**Realtime** is the primary path — sub-second, push. It can die silently: the
socket stays open and simply stops delivering, with nothing logged anywhere.

**A reconcile poll** (15s) re-reads today's `CALLED` rows and diffs them against
the same cache. It catches anything Realtime dropped, and the count of such
recoveries (`recovered_by_poll_today`) is itself the fingerprint of a
subscription that has died while still claiming to be connected.

### On restart

The bridge seeds its cache from current state **without emitting** — otherwise
a restart at 16:00 would replay every call since 09:00 and re-announce the lot.

It then optionally re-asserts the latest call at each counter with
`silent: true`, so the wall shows correct current state without chiming.
`silent` is a documented optional field on `POST /call`; this uses the
interface as specified rather than inventing a display instruction Qtech does
not offer. Disable with `RESYNC_ON_START=false`.

## How Nexus knows the bridge has failed

The bridge writes a heartbeat row to Supabase. Nexus reads one view:

```sql
select bridge_id, state, heartbeat_age_seconds, last_error_code, sent_today, failed_today
from qtech_bridge_status;
```

`state` is `OK`, `DEGRADED`, or `DOWN`. That single column is the whole
contract — no policy logic needs duplicating on the Nexus side.

The failure modes it is built to expose are the quiet ones:

| Failure | How it surfaces |
|---|---|
| Pi powered off, process dead, SD card gone | `updated_at` stops advancing → `DOWN` after 90s (six missed beats) |
| Realtime silently dropped | `realtime_connected = false` → `DEGRADED`; or `recovered_by_poll_today` climbing while it still reads `true` |
| Qtech unreachable or credential rejected | `consecutive_failures >= 3` → `DEGRADED`, with `last_error_code` |
| Qtech answering 200 with `response: "Error"` | `last_error_code` = `COUNTER_UNKNOWN` / `VALIDATION_ERROR` / … — the quietest failure of all, since it succeeds at the HTTP level |
| A number called with no counter assigned | `blocked_today` climbs; the call is refused locally rather than bounced by Qtech |

The heartbeat is the load-bearing part. Every other failure logs *something*
somewhere; a dead Pi logs nothing at all, and the only way to notice is that a
row which should be changing has stopped changing. So the write happens
unconditionally on a timer, not only when something happens.

`qtech_call_log` holds the per-call outcome trail for the daily error-rate
review the acceptance procedure asks for (their Phase 4). No personal data in
either table.

## Install

**Full runbook: `docs/INSTALL.md`** — blank Pi to a bridge Qtech can test
against, including what to request from them, how to drive their acceptance
phases, and troubleshooting. The short version follows.

Apply the schema once, from the Supabase SQL editor:

```
sql/001_qtech_bridge.sql
```

Then on the Pi:

```bash
git clone https://github.com/mwosginfo/nexus-kiosk ~/nexus-kiosk
cd ~/nexus-kiosk/display
sudo ./install.sh
sudo nano /etc/nexus-qtech-bridge.env     # Supabase + Qtech credentials
sudo systemctl restart nexus-qtech-bridge
journalctl -u nexus-qtech-bridge -f
```

The credential file is `0640 root:qtechbridge` and is read by systemd via
`EnvironmentFile=`. It is not in the repo and the secret can be rotated
without a code change — Qtech's item 7.2. Rotation overlap is 7 days on their
side, so a swap is a file edit plus a restart.

## Configuration

See `.env.example` for the full annotated list. The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `QTECH_TRANSPORT` | `tcp` | `tcp` (live) or `http` (fallback) |
| `QTECH_TCP_HOST` / `QTECH_TCP_PORT` | — | Qtech equipment on the PE network. Plaintext is accepted only to a private address |
| `QTECH_TCP_FRAMING` | `newline` | `newline`, `length` or `raw` — see `src/qtech/framing.ts` |
| `QTECH_BASE_URL` | — | HTTP fallback only |
| `QTECH_BRANCH_UUID` | — | Issued at onboarding |
| `QTECH_COUNTER_NAME_FORMAT` | `number` | `number` → `"7"`; `prefixed` → `"Counter 7"`. Both are voice-announceable |
| `QTECH_ALLOWED_COUNTERS` | `1..10` | The list agreed at setup. Nexus caps counter assignment at 1–10. **Notify Qtech before adding one** |
| `RESYNC_ON_START` | `true` | Silent state restore after a restart |
| `DRY_RUN` | `false` | Everything except the outbound POST. Health and log rows still written, outcome `DRY_RUN` |

`DRY_RUN=true` is the intended way to rehearse against live Nexus traffic
before a display is connected.

## Handover

`docs/handover.html` is the written handover for Qtech and MWO — architecture,
interface, delivery behaviour, health monitoring, conformance, open questions
and the responsibility split. Open it in a browser, or read the source docs
below for the same material in working form.

## Conformance CLI

Qtech's acceptance procedure requires calls driven from our system. Sending
them through the live queue would mean calling real clients, so:

```bash
sudo env $(grep -v '^#' /etc/nexus-qtech-bridge.env | xargs) \
  node /opt/nexus-qtech-bridge/dist/src/cli/send-call.js --queue A045 --counter 7
```

Same credentials and payload builder as the bridge, one request, no retry, raw
response printed. `--event <uuid>` twice tests duplicate suppression; a new
`--event` with the same `--ticket` tests a recall. `--health` probes liveness.
Exits non-zero on a business error, which arrives inside an HTTP 200.

## Operating

```bash
systemctl status nexus-qtech-bridge
journalctl -u nexus-qtech-bridge -f          # structured JSON lines
journalctl -u nexus-qtech-bridge -p warning  # problems only
```

Logs are JSON, one line per event, and carry ids and queue numbers only — never
names, emails, or ref codes.

## Development

```bash
npm install
npm run typecheck
npm test          # 80 tests, no network or Supabase needed
npm run build
```

### Prototype tools

```bash
npm run stub -- --port 9100 --branch <uuid> --counters 1,2,3
npm run demo      # drives every acceptance scenario, pass/fail per scenario
```

`npm run stub` is a reference Qtech server implementing `docs/TCP-PROTOCOL.md`:
the wall behaviour, the 10-minute duplicate window, and all three error codes.
`--fail-rate` and `--delay` inject faults to exercise retry and timeout paths.
It is a development tool and is never installed as a service.

The delivery tests run against a real local HTTP server standing in for Qtech,
and assert the behaviours their §4 makes mandatory: retry only on transient
faults, never on business errors, one idempotency key across the retries of a
single call, per-counter ordering, and a closed set of payload keys.

## Network requirements

- Outbound HTTPS (443) to `<tenant>.qtechqms.com` and to the Supabase project.
- No inbound anything. The interface is one-way; the bridge listens on nothing.
- If IP allow-listing is adopted, the egress address to disclose to Qtech is
  the office's public IP as seen from the Pi.

## Handover

`docs/handover.html` is the written handover for Qtech and MWO — architecture,
interface, delivery behaviour, health monitoring, conformance, open questions
and the responsibility split. Open it in a browser, or read the source docs
below for the same material in working form.

## Conformance

`docs/QTECH-CONFORMANCE.md` maps the integration response clause by clause to
this implementation, and is the working record for their Phase 1 and Phase 5.
One genuine gap is recorded there: their item 9 asks for an *operator-visible*
alert after a failed call, and the Nexus-side badge that would provide it does
not exist yet.

## Still open

**With Qtech**

1. Which queue-number prefixes have recorded audio? We emit `A…`, `W…`, `WA…`
   and bare 4-digit numbers; only `A045` is demonstrated in their document.
2. Exact `counterName` strings for the agreed list — `"7"` or `"Counter 7"`.
3. Confirmation that a silent `POST /call` at startup is an acceptable way to
   restore wall state, since there is no clear/refresh instruction.
4. Rate limits behind the documented 429.
5. Test-branch `branchUUID` and credentials for Phase 0.
6. Does `GET /health` need `branchUUID`? "Liveness + branch resolution check"
   suggests it might; the bridge sends a bare authenticated GET.
7. §4's "backoff 1s / 2s / 4s, maximum 3 attempts" — three attempts total, or
   three retries after the first? We take the literal, more conservative
   reading: three attempts, gaps of 1s and 2s.

**With MWO**

1. The wall never clears: whatever is showing at 18:00 stays until the next
   morning's first call. Confirm that is acceptable.
2. Which counter runs the 5-day pilot.
3. Fixed public egress IP for allow-listing, if adopted.
4. Where the `qtech_bridge_status` badge should appear for staff in Nexus —
   that is a Nexus-side change, not part of this repo.
