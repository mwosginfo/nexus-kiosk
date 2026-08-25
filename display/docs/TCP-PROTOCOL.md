# Queue call interface over TCP — proposed specification

**Version 0.1 — proposed by MWO-OWWA, 2026-08-20. For Qtech confirmation.**

Qtech advised that the queue interface moves from HTTPS to TCP, with the JSON
unchanged, to equipment on the same premises as the bridge. This document is
what we have implemented on that basis: the semantics of the 5 August
integration response, carried over TCP.

It is a proposal, not a decision. Where we have had to choose something the
original document did not cover, the choice is marked **[assumed]** with the
reasoning, so Qtech can confirm or correct it. Everything else is carried over
unchanged from their document and marked **[unchanged]**.

A working reference implementation of this specification ships alongside it —
see §9 — so it can be exercised rather than only read.

---

## 1. Transport

| | |
|---|---|
| Protocol | TCP **[assumed]** |
| Encryption | None. Both endpoints are on the PE network **[per Qtech]** |
| Authentication | None **[per Qtech]** |
| Encoding | UTF-8 **[assumed]** |
| Byte order | Big-endian, where length prefixes are used **[assumed]** |

### 1.1 Connection model **[assumed]**

**One connection per call.** The client connects, sends one request, reads one
response, and closes.

We propose this rather than a long-lived connection for a specific reason. A
persistent TCP connection can go *half-open*: the peer disappears without
sending a FIN, the socket stays open, writes continue to succeed into the local
kernel buffer, and no error is raised at either end. The client would go on
announcing into a dead connection while the display silently stopped updating.
That is precisely the failure item 7.9 of the integration response asks us to
make visible to counter staff, and per-connection exchanges make it impossible
rather than merely detectable.

On a local network the handshake costs on the order of a millisecond against a
call volume of a few hundred per day. Measured against the reference server,
a complete exchange takes 0–3 ms.

If Qtech require a persistent connection instead, we would need an
application-level ping with an expected reply, and should discuss it.

## 2. Framing **[assumed — the main thing to confirm]**

TCP is a byte stream with no message boundaries, so both ends must agree where
one message ends and the next begins. The original document did not need to
address this, because HTTP framed messages for it.

**Proposed: newline-delimited.** One JSON object, UTF-8, followed by a single
`\n` (0x0A). The JSON itself contains no unescaped newlines.

Two alternatives are also implemented, should Qtech's equipment expect one:

| Name | Layout |
|---|---|
| `newline` *(proposed)* | `<json>\n` |
| `length` | `<uint32 big-endian length><json>` |
| `raw` | `<json>`, with the sender closing the connection to delimit |

Selecting a different one is a configuration change on our side, not a rebuild.

## 3. Request **[unchanged]**

One JSON object per call. Fields exactly as §1 of the integration response:

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventId` | string (UUID) | yes | Unique per message; reused only on retry |
| `ticketID` | string, ≤64 | yes | Unique per ticket, never reused, opaque |
| `branchUUID` | string | yes | Issued at onboarding |
| `counterName` | string | yes | From the agreed list; numeric so it can be announced |
| `queueNo` | string | yes | Displayed verbatim |
| `silent` | boolean | no | Suppresses chime and voice |
| `timestamp` | string (ISO 8601) | yes | Audit only |

No personal data is sent. `ticketID` is an opaque identifier.

## 4. Response **[assumed to be unchanged]**

The same envelope the HTTPS interface returned.

**This is the single most important thing to confirm.** Three behaviours the
integration response specifies depend on there being a reply: the §4 retry rule
that separates transient faults from business errors, duplicate suppression,
and knowing whether a call reached the display at all. If the TCP interface
does not reply, all three stop working and the design needs revisiting.

Success:

```json
{
  "response": "Success",
  "message": {
    "eventId":     "b3f1c2e0-9a44-5c81-b0f2-7d1e4a2c9f30",
    "ticketID":    "4c9a1e77-2b6d-4f80-9e13-8a5c2f0b7d64",
    "queueNo":     "A045",
    "counterName": "7",
    "status":      "ON_CALL",
    "serverTime":  "2026-08-20T09:14:22.481+08:00",
    "duplicate":   false
  }
}
```

Error:

```json
{ "response": "Error", "code": "COUNTER_UNKNOWN" }
```

Our parser accepts the code at `code`, `error`, or `message.status`, and treats
a `message` string as the code, so a reasonable variation will still be
understood rather than rejected.

## 5. Error codes **[unchanged]**

| Code | Meaning | Client behaviour |
|---|---|---|
| `BRANCH_NOT_FOUND` | `branchUUID` unknown | Never retried |
| `COUNTER_UNKNOWN` | `counterName` not on the agreed list | Never retried |
| `VALIDATION_ERROR` | Malformed or missing field; the field is named | Never retried |

## 6. Duplicate handling **[unchanged, needs confirming for TCP]**

A repeat of the same `eventId` within **10 minutes** returns the original
outcome with `"duplicate": true`, and does not re-announce.

This is what makes a retry safe. The client derives `eventId` from the call
itself, so a retry reuses the key while a deliberate recall — same `ticketID`,
new `eventId` — produces a new one and does re-announce.

## 7. Timeouts and retry **[unchanged, mapped to TCP]**

| Condition | Client behaviour |
|---|---|
| Connection refused, reset, or timeout | Retry — 3 attempts, gaps of 1s then 2s |
| Peer closes without replying | Retry, as above |
| Any error code from §5 | Never retried |
| Reply that is not valid JSON, or not this envelope | Never retried |
| Client timeout | 10 seconds, covering connect, send and reply |

After the final attempt the client stops and records the failure. Per §4 of the
integration response, stopping is safe: the next call to that counter
supersedes the lost one.

## 8. Worked example

An actual exchange with the reference server, byte for byte. `→` is the client,
`←` is the server. `\n` is a literal 0x0A.

```
→  228 bytes
{"eventId":"b3f1c2e0-9a44-5c81-b0f2-7d1e4a2c9f30","ticketID":"4c9a1e77-2b6d-4f80-9e13-8a5c2f0b7d64","branchUUID":"c761bfe7-0000-4000-8000-000000000001","counterName":"7","queueNo":"A045","timestamp":"2026-08-20T09:14:22+08:00"}\n

←  246 bytes
{"response":"Success","message":{"eventId":"b3f1c2e0-9a44-5c81-b0f2-7d1e4a2c9f30","ticketID":"4c9a1e77-2b6d-4f80-9e13-8a5c2f0b7d64","queueNo":"A045","counterName":"7","status":"ON_CALL","serverTime":"2026-08-25T07:04:03.559Z","duplicate":false}}\n
```

A recall of the same ticket — new `eventId`, same `ticketID` — announces again.
A replay of the same `eventId` returns `"duplicate": true` and does not.

## 9. Reference implementation

A working server implementing this document ships with the bridge, so the
specification can be exercised rather than only reviewed:

```bash
npm run stub -- --port 9100 --branch <uuid> --counters 1,2,3
```

It reproduces the wall behaviour of §2 of the integration response (a number
stays on its counter until that counter calls another), the duplicate window,
and all three error codes. `--fail-rate` and `--delay` inject faults for
exercising retry and timeout handling.

```bash
npm run demo
```

drives every scenario in the acceptance procedure — idle-counter call,
replacing call, concurrent calls, recall, replayed event id, silent call,
severed link — and reports pass or fail per scenario.

If any of this does not match Qtech's equipment, the reference server is the
quickest way to show us what it should do instead.

## 10. What differs from the HTTPS interface

| | HTTPS (5 Aug) | TCP (proposed) |
|---|---|---|
| Carrier | HTTPS REST | Raw TCP |
| Framing | HTTP | Newline-delimited **[assumed]** |
| Encryption | TLS 1.2+ | None — on-premises **[per Qtech]** |
| Authentication | HTTP Basic | None **[per Qtech]** |
| Liveness | `GET /health` | Connect and close **[assumed]** |
| Transient failure | HTTP 5xx, 429 | Connection refused, reset, timeout |
| Request JSON | — | Unchanged |
| Response JSON | — | Unchanged **[assumed]** |
| Error codes | — | Unchanged |
| Duplicate window | 10 minutes | Unchanged **[to confirm]** |
| Retry policy | 3 attempts, 1s/2s | Unchanged |

## 11. Open points for Qtech

1. **Framing** (§2) — newline, length-prefixed, or something else?
2. **Does the endpoint reply?** (§4) — everything in §5 to §7 depends on it.
3. **Connection model** (§1.1) — is per-call acceptable, or is a persistent
   connection required?
4. **Liveness** (§10) — is connect-and-close acceptable, or is there a probe
   message?
5. **Duplicate window** (§6) — does the 10-minute suppression still apply?
6. **Host and port** for the test endpoint and for production.
