# The Qtech TCP interface, as implemented

Transcribed from the `call.bat` reference client Qtech supplied on 2026-08-20,
and implemented in `src/qtech/tcp-transport.ts`. This supersedes the proposal
in `TCP-PROTOCOL.md` for everything it covers.

---

## The wire

| | |
|---|---|
| Host | `10.253.158.127` (PE network) |
| Port | `4009` |
| Framing | One UTF-8 JSON object, then `\n` (0x0A) |
| Connection | One per call: connect, write, close |
| Encryption | None |
| Authentication | `authToken` field in every message |
| Reply | **None** |

## The message

```json
{
  "type":        "CALL",
  "ticketID":    "4c9a1e77-2b6d-4f80-9e13-8a5c2f0b7d64",
  "clientId":    "mwo-owwa",
  "branchUUID":  "mwo",
  "counterName": "7",
  "queueNo":     "A045",
  "silent":      false,
  "timestamp":   "2026-08-20T09:14:22+08:00",
  "authToken":   "QT-MWO-…"
}
```

Two deliberate differences from their sample client, both improvements that
stay inside the contract:

- **`ticketID`** — their sample uses `'T' + epoch_ms`, which collides if two
  calls land in the same millisecond. We send the check-in row's UUID: opaque,
  unique, never reused, and no personal data. Their own §6 asks for exactly
  that.
- **No `eventId`** — their protocol has none, so we do not invent one. It
  remains our internal key for the call log and retry identity.

## What was confirmed, and what it costs

Three of our assumptions held: newline framing, one connection per call, and a
private network address. The port moved from 9100 to 4009 and three fields were
added.

The consequential finding is that **their client writes and closes without
reading**. There is no reply, no error code, and no idempotency key. Three
guarantees from the 5 August integration response do not survive that:

| Guarantee | Status |
|---|---|
| §4 retry rule — retry transient faults, never business errors | **Gone.** Both are unreported. We can only observe connection-level failures |
| §4 duplicate suppression on `eventId` | **Gone.** No key on the wire, so a repeat re-announces |
| Item 7.9 — tell staff the display may be stale | **Weakened.** "Delivered" now means "written to a socket that accepted the bytes" |

A call rejected on their side — bad token, unknown counter, malformed
payload — is invisible to us. It looks exactly like a successful call.

## What we do about it

**Our detection cache is now load-bearing.** With no duplicate suppression on
their side, the bridge's own call-detection cache is the only thing preventing
a double-fire from announcing a number twice. It was a nicety under the HTTP
interface; it is a correctness requirement now.

**Optimistic acknowledgement.** We write exactly what their client writes, then
listen for 250 ms before closing. Nothing promises a reply. If one arrives, it
is parsed and classified and the §4 retry rule works properly again. If not,
the successful write is recorded as an unconfirmed send. The cost is a fraction
of a second on a link that completes in single-digit milliseconds; the benefit
is that any error signalling Qtech add, now or later, is picked up without a
code change. `QTECH_ACK_WAIT_MS=0` mirrors their client exactly.

**Honest health reporting.** `qtech_bridge_status` still catches a dead bridge,
a failed Supabase link, and an unreachable Qtech endpoint. It cannot catch a
call the endpoint received and rejected. That limit is the protocol's, not the
bridge's, and it should be stated plainly to whoever relies on the badge.

## The token is required

Qtech's response said the on-premises protocol carries no authentication. Their
`call.bat` sends `authToken` in every message. Both can be true: there is no
TLS and no HTTP Basic, but there is a bearer token in the payload.

Because the protocol never replies, **we cannot tell whether their server
validates it.** A rejected call and an announced call look identical from here.
So the bridge refuses to start without one rather than sending a placeholder:
a wrong token would mean every call rejected, the health row reading OK, and a
blank wall with nothing anywhere to explain it.

## Handling the token

Qtech supplied it inside a batch file, in clear, to be sent in clear over the
network. On the PE network that is their call. On our side it is treated as a
secret: it lives in `/etc/nexus-qtech-bridge.env`, mode 0640, not in source
control, and rotating it is an edit and a restart.

It is worth noting the difference between their position and their practice.
Their integration response said the on-premises protocol carries no
authentication. It carries a bearer token, which is authentication — just
without transport security. Anyone on the PE network who can read that batch
file, or watch the traffic, can call any number to any counter.

## Testing without Qtech

```bash
npm run stub -- --port 4009 --branch mwo --token <token> --counters 1,2,3
```

Reproduces their endpoint, including replying with nothing. Add `--reply` to
make it acknowledge, which is how the error paths above can be exercised at
all — worth doing at least once so the team has seen what the bridge does when
a call is rejected, even though the live endpoint will never say so.

```bash
npm run demo
```

Runs every acceptance scenario and reports pass or fail per scenario.

## Worth raising with Qtech

1. **Is a reply available?** Even a bare accept/reject would restore the retry
   rule and let us honour item 7.9 properly. This is the single change with the
   most value.
2. **Is `eventId` accepted if sent?** If their parser tolerates it and their
   server suppresses duplicates, retries become safe again.
3. **What happens to a rejected call?** Is it logged their side, and can we
   get at that log during the pilot?
4. Which queue-number prefixes have recorded audio — `A`, `W`, `WA`.
5. Confirm the counter list matches `1`–`10`.
