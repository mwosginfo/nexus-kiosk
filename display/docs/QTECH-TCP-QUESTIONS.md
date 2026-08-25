# TCP transport — specification request

Qtech advised (2026-08-20) that the queue interface will use TCP rather than
HTTP, with the workflow unchanged.

We agree the workflow is unchanged: one call event whenever a number is called
to a counter, no other events. Everything above the transport in our bridge —
call detection, event id derivation, per-counter ordering, health reporting —
is unaffected and needs no change.

What we cannot do is implement the transport, because "TCP instead of HTTP" is
not by itself a protocol. HTTP already runs over TCP; the change is from a
specified request/response protocol to something else, and the 5 August
integration response defines the interface entirely in HTTP terms. Sections 1,
3, 4 and 6 of that document, and the Phase 1 exit criteria in §8 ("every
response matches the published schema and error codes"), no longer have a
subject.

The questions below are ordered by how much each one changes on our side.
Question 1 is the one that matters most.

---

## 1. Does the protocol acknowledge each call?

**Why it matters more than anything else here.** The integration response §1
states: *"Synchronous — the HTTP response carries the outcome of the call."*
Three features we built are downstream of that single sentence:

- **Retry.** §4 says retry on transient faults and never on a business error.
  Without an acknowledgement we cannot tell the two apart, so we cannot
  implement that rule. We would be retrying blind or not at all.
- **Duplicate handling.** §4 says a repeated `eventId` returns
  `"duplicate": true` and is not re-announced. With no response we never learn
  this, and cannot report it.
- **Knowing a call landed.** Our health reporting tells MWO counter staff
  whether the display is being fed. Without acknowledgement, "sent" degrades
  to "written to a socket", which is not the same claim — see question 6.

Please confirm one of:

- **(a)** Each call receives a response frame carrying an outcome, as the HTTP
  interface did. *Preferred — everything specified in the 5 August document
  continues to hold and our change is confined to framing.*
- **(b)** Calls are acknowledged, but only as accepted/rejected with no
  detail.
- **(c)** Fire-and-forget, no acknowledgement.

If **(c)**, we would like to discuss it before proceeding. It removes the
delivery guarantees your own document specifies, and it means neither party
can tell a working link from a broken one until somebody looks at the wall.

## 2. Framing

How is one message delimited on the stream?

- Newline-delimited JSON, length-prefixed, fixed-width, or something else?
- If length-prefixed: prefix width, endianness, and whether the length
  includes the prefix.
- Character encoding, and maximum message size.

## 3. TLS

Integration response §3: *"HTTPS only, TLS 1.2 or higher. Plain HTTP is not
offered for this integration."*

- Is the TCP connection TLS-wrapped?
- If so, is it TLS on connect (implicit) or negotiated after a plaintext
  handshake?
- Certificate details, and whether client certificates are now in scope (§3
  previously excluded mutual TLS).

If the answer is plaintext TCP, we would like to raise it formally. Queue
numbers and counter assignments are not sensitive on their own, but the
credential is, and a plaintext credential on a shared network is a materially
weaker position than the one your document describes. Our bridge currently
refuses to start against a non-TLS endpoint, deliberately.

## 4. Authentication

HTTP Basic is an HTTP mechanism and does not carry over.

- Is there a login or handshake frame at connection time?
- Or a credential field on every message?
- Or is authentication now IP allow-listing alone?
- What is returned on an authentication failure, and does the server close the
  connection?
- Does the 7-day overlap during secret rotation (§3) still apply?

## 5. Error signalling

The stable codes in §1 — `BRANCH_NOT_FOUND`, `COUNTER_UNKNOWN`,
`VALIDATION_ERROR` — were carried in an HTTP response body, and our retry rule
keys on them.

- Do these codes survive, and in what frame?
- What is the equivalent of HTTP 5xx and 429 — that is, how do we distinguish
  "retry this" from "never retry this"?
- Is there a rate limit, and how is it signalled?

## 6. Connection model and liveness

This is where raw TCP is materially harder than HTTP, and where we would like
your guidance.

- One persistent connection, or a connection per call?
- If persistent: is there a keepalive or ping frame, and at what interval?
- What replaces `GET /health`?
- What is the expected behaviour on idle — does the server close an idle
  connection, and after how long?
- On reconnect, is any session state re-established, or is each connection
  independent?

**The half-open problem.** A TCP connection can appear healthy while
delivering nothing: the peer is gone, no FIN was received, and our writes
succeed into the local kernel buffer. Under HTTP every call was its own
request with its own response, so a broken link surfaced on the very next
call. With a persistent socket and no application-level acknowledgement, we
can write calls into a dead connection indefinitely with no error raised
anywhere — while the wall silently stops updating.

We will tune TCP keepalives, but keepalives are slow and coarse. An
application-level ping with an expected reply is the reliable answer. If the
protocol has one, please specify it; if not, we would like to discuss adding
one, because without it neither side can honour your item 7.9 — the
operator-visible alert telling counter staff the display may be stale.

## 7. Endpoint

- Host and port for the test branch, and for production.
- Is `branchUUID` still carried per message, or established once per
  connection?
- Are the six fields (`eventId`, `ticketID`, `branchUUID`, `counterName`,
  `queueNo`, `timestamp`) and the optional `silent` unchanged? We assume so,
  since the workflow is unchanged.
- Does the 10-minute duplicate window on `eventId` still apply?

## 8. Documentation and acceptance

- A written protocol specification equivalent to §1 of the 5 August document:
  frame layout, field types, example exchanges, and the error catalogue.
- Confirmation of which parts of the 5 August document still stand. Our
  reading is that §2 (event model), §5 (hosting), §6 (minimum data set) and §7
  items 2–10 are unaffected, while §1, §3, §4 and the Phase 1 criteria in §8
  need reissuing.
- Whether the acceptance phases in §8 are otherwise unchanged.

---

## Our side

For planning, once the above is answered:

**Unchanged** — call detection across both Nexus code paths, event id
derivation, queue number and counter formatting, per-counter serialisation,
the health and call-log schema, the installer, and the systemd service. These
are transport-agnostic and were built that way.

**Changes** — the transport implementation and the wire schemas, roughly two
of fifteen source files, plus configuration (host and port in place of a URL)
and the conformance CLI. A transport interface is already extracted, so the
swap is an addition rather than a rewrite.

**Depends on the answers** — if question 1 comes back as fire-and-forget, the
retry policy, duplicate reporting and a meaningful part of the health
reporting have to be redesigned, and we would want to agree what "delivered"
means before building it.

**Estimate** — with answer (a) and a written specification, the transport work
is small and the existing test suite carries over. With answer (c) the change
is larger and the guarantees are weaker, and we would want a conversation
first.
