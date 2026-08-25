# TCP transport — outstanding questions

**Updated 2026-08-20** after Qtech confirmed the JSON is unchanged and only the
carrier differs: same request object, over TCP instead of HTTPS, to equipment
on the same network as the bridge, with no TLS and no authentication.

That answered most of what we had asked. The TCP transport is built and tested
against a real socket; the list below is what remains.

---

## What we took as settled

Because the JSON is unchanged, we have assumed the response envelope is too —
`{"response":"Success","message":{…}}` on success and `{"response":"Error"}`
with the stable codes on failure. That single assumption keeps everything we
built working: the §4 retry rule that separates transient faults from business
errors, duplicate reporting, and knowing whether a call actually landed.

**If the TCP interface does not reply at all, tell us before anything else** —
all three of those stop working and we would need to talk.

---

## 1. Framing — the one thing that blocks us

TCP is a byte stream with no message boundaries, so "JSON over TCP" is not yet
a complete instruction: both ends must agree where one message ends and the
next begins.

Which of these does the endpoint use?

| | Convention |
|---|---|
| **a** | JSON followed by a newline (`\n`) |
| **b** | A 4-byte big-endian length, then that many bytes of JSON |
| **c** | JSON alone, with the connection close delimiting the reply |
| **d** | Something else — please describe |

All three are implemented, so confirming this is a one-line configuration
change on our side rather than new work. We have defaulted to **(a)**.

## 2. Host and port

For the test endpoint and, later, for production.

## 3. Connection model

We open a connection per call, send, read the reply and close.

On a local network the handshake costs about a millisecond against a few
hundred calls a day, and it avoids a failure mode worth avoiding: a long-lived
TCP connection whose peer has gone away without a proper close stays open,
accepts writes, and reports no error — so we would be announcing into a dead
socket while the display quietly stopped updating.

Does that suit your endpoint, or do you require a persistent connection? If
persistent, we will need an application-level ping with an expected reply,
because without one neither side can detect that situation.

## 4. Liveness

There is no TCP equivalent of `GET /health` in the specification. We currently
open a connection and close it without sending anything, which tells us whether
the endpoint is accepting connections. Is that acceptable, or is there a
proper probe message?

## 5. Duplicate window

Does the ten-minute duplicate suppression on `eventId` still apply on TCP? Our
retry safety depends on it: we derive the event id so that a retry reuses the
same key and a deliberate recall gets a new one.

---

## Also useful, unchanged from before

- Which queue number prefixes have recorded audio? We send `A…`, `W…`, `WA…`
  and bare four-digit numbers; only `A045` appears in your document.
- Exact `counterName` strings for the agreed list — `"7"` or `"Counter 7"`.
- Confirmation of which parts of the 5 August document still stand. Our
  reading is that §2, §5, §6 and item 7.2–7.10 are unaffected, §1 needs the
  framing detail above, §3 is superseded by the on-premises arrangement, §4
  still applies apart from the HTTP status codes, and Phase 1's "matches the
  published schema" needs restating for the new carrier.
