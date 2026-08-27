# Reply to Qtech — after the call.bat handover

Short, informal. Sent as a text or chat message, not an email.

---

## Send this

> Thanks for the batch file, that sorted it. We've got it working our side —
> calls going out to 4009, same JSON, newline at the end, connection per call.
>
> One thing worth flagging: your client just writes and closes, so nothing
> comes back. Means if the display rejects a call — bad token, counter not on
> the list, whatever — it looks exactly the same to us as one that worked. We'd
> have no idea.
>
> Any chance the endpoint can send back even a simple ok/error? Would let us
> warn our counter staff when the display might be out of sync. If it's not
> possible we can live with it, just want to be clear on what we can and can't
> see.
>
> Also, do the voice announcements handle W and WA prefixes? We use those for
> walk-ins, alongside the A series and plain numbers.

## Even shorter, if needed

> Thanks, batch file sorted it — we're sending to 4009 fine now.
>
> One thing: since your client writes and closes without reading, we can't tell
> a rejected call from a good one. Any chance of a simple ok/error back? Helps
> us flag to staff when the display might be stale. Not a blocker either way.
>
> Also do the announcements cover W / WA prefixes? We use them for walk-ins.

---

## Why the acknowledgement is the one to push on

It restores three things their own 5 August document specified: the retry rule
that separates transient faults from business errors, duplicate suppression,
and item 9's operator-visible alert. Everything else on the list is minor next
to it. Full detail in `QTECH-PROTOCOL-ACTUAL.md`.
