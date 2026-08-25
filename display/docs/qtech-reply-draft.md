# Draft reply to Qtech — TCP transport

Two versions: a couple of lines to send straight away, and the real reply.
Attach `QTECH-TCP-QUESTIONS.md` to the second one.

That attachment is deliberately technical, because their developer is the one
who has to answer it. The email below is for the person you're actually
talking to, so it stays in plain language.

---

## Version A — quick reply, send now

> Subject: RE: MWO–OWWA queue display
>
> Thanks for the heads up.
>
> Good news is it shouldn't affect much on our end. Our software keeps the
> queue side separate from the part that sends messages to you, so we only
> need to rewrite the sending part.
>
> Before we can do that we'll need the details of how the new connection
> works, since your August document describes the old web-based method
> throughout. I'll send our developer's questions over today. There's one in
> particular I'd like to flag: whether your system sends anything back when we
> send a number.
>
> Everything else on our side is finished and tested, so we should be able to
> move fast once we have the details.

---

## Version B — the real reply

> Subject: Queue display — a few questions about the switch to TCP
>
> Hi [name],
>
> Thanks for letting us know about the move to TCP.
>
> The good news is that it doesn't change much on our end. Our software was
> built so the queue logic sits separately from the part that actually sends
> the message across to you. That means the bulk of it stays as it is and we
> only need to rewrite the sending part.
>
> To do that, though, we need the details of how the new connection works.
> Your 5 August document describes everything in terms of the old web-based
> method: the message format, the security, the error codes, the test plan.
> None of that carries across on its own. Could you send us the equivalent for
> TCP, and let us know which parts of the original document still apply?
>
> I've attached the specific list our developer put together. One question on
> it matters more than the rest, so I'll raise it here.
>
> **When we send a number across, does your system send anything back?**
>
> With the old method, every message got a reply telling us whether it worked.
> We built three things around that:
>
> * If a message fails, we know to try again. And we know when not to bother,
>   because some problems won't fix themselves no matter how many times we
>   resend.
> * If we accidentally send the same number twice, your system tells us, so it
>   doesn't get announced twice.
> * We can warn our counter staff when the screen has stopped updating, which
>   is the thing you asked for as item 9 in your requirements.
>
> If the new method still sends a reply, all three keep working and the change
> is a small one for us. If it doesn't reply at all, none of them work, and
> we'd rather talk that through before either side starts building.
>
> Two other things worth settling now rather than during testing.
>
> **Is the connection encrypted?** Your document said the old method was, and
> that an unencrypted option wasn't on offer. We'd like to confirm that still
> holds. Our software currently refuses to run without encryption, which was a
> deliberate decision so the password never goes across in plain text.
>
> **If the connection stays open, is there a way to check it's still alive?**
> This sounds like a small thing but it isn't. A connection can stop working
> without anything looking wrong. From our side it still appears connected and
> our messages still appear to send, but nothing is arriving at your end. With
> the old method we'd have found out on the very next number called. With a
> permanently open connection, we could be sending numbers into nothing all
> afternoon while the screen sits there looking perfectly normal. If there's
> already a built-in "are you still there?" check, that solves it. If not, I
> think we should add one, because without it neither of us can really deliver
> item 9.
>
> Everything else on our side is finished and tested. We've built a small tool
> that can run the tests you set out in phases 1 to 3, so once we have the
> specification we should move quickly.
>
> While you're at it, could we also get the test branch details, the login,
> the counter list, and the address and port we should be connecting to?
>
> Thanks,
> [name]

---

## Attach

`QTECH-TCP-QUESTIONS.md` — the full list, numbered so their developer can
reply point by point.
