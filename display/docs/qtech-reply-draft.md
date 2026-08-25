# Draft reply to Qtech — TCP transport

Correspondence draft. Two versions: a short acknowledgement to send
immediately, and the substantive reply. Attach or link
`QTECH-TCP-QUESTIONS.md` with the second.

---

## Version A — short acknowledgement (send now)

> **Subject:** RE: MWO–OWWA queue integration — TCP transport
>
> Thank you for the update.
>
> Understood on the workflow being unchanged — that matches our
> implementation, which is built so the call logic is independent of how the
> message reaches you. On our side the change is confined to the transport
> layer.
>
> Before we can build it we will need the protocol specification, since the
> 5 August integration response defines the interface in HTTP terms
> throughout. We are sending a short list of specific questions today, the
> most important being whether the TCP protocol acknowledges each call.
>
> Everything else on our side is complete and tested, so we expect to move
> quickly once we have the specification.

---

## Version B — substantive reply

> **Subject:** MWO–OWWA queue integration — questions on the TCP transport
>
> Thank you for letting us know about the move to TCP.
>
> We can confirm the workflow is unchanged from our side: one call event
> whenever a number is called to a counter, no other events, and the same six
> fields you specified. Our bridge was built with the call logic separated
> from the transport, so that logic — including recall handling, per-counter
> ordering and the idempotency key derivation — carries over without change.
> The work for us is confined to the transport layer and the wire format.
>
> Before we can implement it, we need the protocol specification. The 5 August
> integration response defines the interface in HTTP terms throughout — the
> request and response schemas in §1, the transport security commitments in
> §3, the retry and duplicate rules in §4, and the Phase 1 exit criteria in §8
> all refer to HTTP constructs that no longer apply. Could you confirm which
> parts of that document still stand, and reissue the sections that do not?
>
> The specific questions are attached. The first is the one that most affects
> our design, so I will summarise it here.
>
> **Does the TCP protocol acknowledge each call?**
>
> Section 1 of your response states that the interface is synchronous and that
> the response carries the outcome of the call. Three behaviours you specified
> depend on that:
>
> - the §4 retry rule, which requires us to distinguish a transient fault from
>   a business error and retry only the former;
> - duplicate handling, where a repeated `eventId` returns `duplicate: true`;
> - and item 7.9, the operator-visible alert telling counter staff the display
>   may be stale, which requires us to know whether a call actually landed.
>
> If each call is acknowledged, all three continue to work and our change is
> straightforward. If the TCP interface is fire-and-forget, none of them can be
> implemented as specified, and we would like to discuss that before either
> side commits to a design.
>
> Two further points we would raise now rather than at testing:
>
> **Transport security.** Section 3 commits to TLS 1.2 or higher and states
> that plain HTTP is not offered. Could you confirm the TCP connection is
> TLS-wrapped? Our implementation currently refuses to start against a non-TLS
> endpoint, which was a deliberate choice to prevent the credential being sent
> in clear.
>
> **Connection liveness.** If the connection is persistent, is there an
> application-level ping with an expected reply? A TCP connection can remain
> open while delivering nothing — the peer is gone, no close is received, and
> writes continue to succeed locally. Under HTTP this surfaced on the next
> call. With a persistent socket and no acknowledgement, calls can be written
> into a dead connection indefinitely while the display quietly stops
> updating. TCP keepalives help but are slow and coarse; an acknowledged ping
> is the dependable answer. If the protocol does not have one, we would like to
> discuss adding it, as without it neither party can satisfy item 7.9.
>
> Everything else on our side is complete: the bridge is installed and tested,
> with automated coverage of the call flow, the retry rules and the failure
> paths, and a command-line tool ready to drive the Phase 1 to 3 tests you
> described. We expect to move quickly once we have the specification.
>
> We would also still like the Phase 0 items when convenient — the test branch
> identifier, credentials, and the counter list — along with the endpoint host
> and port.

---

## Attach

`QTECH-TCP-QUESTIONS.md` — the eight questions in full, numbered so their
engineer can answer inline.
