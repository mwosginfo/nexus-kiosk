# Session handover — Nexus↔Qtech bridge

For a Claude session with shell access on the Pi. Written 2026-09-01 at the end
of a full day of integration debugging. Read this before touching anything —
most of the obvious things have already been tried and ruled out.

---

## 1. The machines

| Host | Address | What it is | Access |
|---|---|---|---|
| **Pi** | `10.253.158.254` | Runs the bridge. You are here. | user `pi`, sudo |
| Qtech service | `10.253.158.127:4009` | Accepts calls. Virtual MAC `42:a6:cf:e4:0d:00`, **only port 4009 open** | no shell |
| Qtech app box | `10.253.158.25` | `java -jar QTX_V5_70.jar` + a node server + Xwayland + **adb**. Physical MAC `d8:5e:d3:e8:3b:b0` | SSH as `qtech` |
| Nexus | separate MWO LAN | The queue system. **Not reachable from here** | — |
| Supabase | cloud | The only path between Nexus and the Pi | — |

All three local hosts are on `10.253.158.0/24`, ARP-adjacent, same physical
segment. This is verified, repeatedly. Do not re-litigate the network.

## 2. What the bridge is

Watches Supabase `kiosk_checkins` for calls Nexus makes, forwards each one to
Qtech over TCP. Nothing else.

```
Nexus ──► Supabase ──► bridge (this Pi) ──► Qtech .127 ──► display
 MWO LAN    internet         PE network        local
```

| | |
|---|---|
| Source | `~/nexus-kiosk/display` |
| Deployed | `/opt/nexus-qtech-bridge` |
| Service | `nexus-qtech-bridge.service` |
| Config | `/etc/nexus-qtech-bridge.env` (0640 root:qtechbridge) |
| Runtime | **Node 22+ required** — see gotcha 1 |

Protocol: one newline-terminated JSON object per call, one TCP connection per
call, **no reply of any kind**. Full detail in `docs/QTECH-PROTOCOL-ACTUAL.md`.

## 3. Where things actually stand

**The bridge works.** Verified live: calls delivered for every queue series
(`6034` REGULAR, `A042` FRA, `W602` walk-in, `9039` OWWA), a recall, and five
different counters. 5–8 ms per call. The boot resync fires correctly.

**Nothing appears on the display.** Not from the bridge, and **not from
Qtech's own `call.bat` run from a separate Windows machine.** That last fact
removes the bridge from the question entirely.

## 4. Already eliminated — do not repeat

| Ruled out | How |
|---|---|
| Wrong LAN / routing | ARP-resolved, direct route, same /24 |
| Firewall or proxy intercepting | Only 4009 open; four other ports actively refuse |
| Display box offline | `.25` ARP-resolves and is running the app |
| Wrong or missing token | Confirmed correct in the env file |
| Payload format | Byte-identical to `call.bat` — same 9 fields, framing, timestamp layout, ticket shape |
| Payload variations | 8 variants probed (counter, silent, branch case, UUID ticket, UTC timestamp, worded counter). None displayed |
| Endpoint replying at all | Socket held open 10 s after a valid call. Nothing, ever |

## 5. Open threads

1. **Qtech asked us to set the clock on the TV box.** This is the live lead and
   probably the best one — we send a `timestamp`, and a display app comparing
   it against a wrong local clock would silently drop calls. From `.25`:
   `adb devices -l`, `adb shell date`, then
   `adb shell settings put global auto_time 1`. Retest immediately after.
2. **Firewall hardening**, planned but not applied. See §7.
3. **`rpcbind` on port 111** should be disabled and masked — not needed, and
   the only listener besides sshd.
4. **Waiting on Qtech**: is anything arriving at their app, is branch `mwo`
   provisioned, are counters 1–10 registered, is the display bound to `.127`.
5. **Not built**: their item 9 asks for an operator-visible alert in Nexus when
   a call fails. The data is in `qtech_bridge_status`; nothing displays it.

## 6. Gotchas learned the hard way today

1. **Node 20 crash-loops.** `@supabase/supabase-js` needs a native WebSocket,
   which arrived in Node 22. Symptom: `native WebSocket not found`, restarting
   every 5 s. The installer now refuses below 22.
2. **systemd reads placeholders literally.** `QTECH_AUTH_TOKEN=<token from
   Qtech>` was never replaced. `EnvironmentFile` is not a shell — it passed
   that string through, the bridge sent it, Qtech rejected everything silently.
   Two hours lost. The config now rejects placeholder-looking values.
3. **`NRestarts` is cumulative**, not live. A high count on a stable service is
   history, not a crash loop. Cleared with `systemctl reset-failed`.
4. **`call delivered` in the log does not mean displayed.** The protocol never
   replies, so "delivered" only means the socket accepted the bytes. This is
   the single most important thing to understand about this integration.

## 7. Commands

```bash
# Health of everything, safe to paste into a chat (masks secrets)
cd ~/nexus-kiosk/display && sudo ./scripts/diagnose.sh

# Service
systemctl status nexus-qtech-bridge
journalctl -u nexus-qtech-bridge -f
journalctl -u nexus-qtech-bridge -p err -n 50

# Send one call by hand (byte-identical to call.bat)
sudo bash -c 'set -a; . /etc/nexus-qtech-bridge.env; set +a; node /tmp/qcall.sh'
/tmp/qcall.sh 10.253.158.127 4009 A099 7

# Eight payload variants, each with its own queue number
sudo bash -c 'set -a; . /etc/nexus-qtech-bridge.env; set +a; node /tmp/qtech-probe.cjs'

# Reference Qtech server, for testing without their equipment
cd ~/nexus-kiosk/display && npm run stub -- --port 4009 --reply
npm run demo        # drives every acceptance scenario
```

From Supabase:

```sql
select state, heartbeat_age_seconds, sent_today, failed_today, last_error_code
from qtech_bridge_status;

select created_at, queue_no, counter_name, outcome
from qtech_call_log order by created_at desc limit 20;
```

### Firewall (planned, not yet applied)

Set a safety net first — you are on SSH:

```bash
sudo bash -c 'nohup sh -c "sleep 900; ufw --force disable" >/dev/null 2>&1 &'
```

Then: default deny both ways; **in** SSH from `10.253.158.0/24` only; **out**
443 (Supabase), 4009 to `10.253.158.127`, 53 DNS, 123 NTP, 67 DHCP. DNS and
DHCP are the two that break things hours later if forgotten — `eth0` is
dynamic. Verify `realtime subscribed` appears after enabling, then
`sudo pkill -f "sleep 900"`.

## 8. Please don't

- **Don't re-debug the payload.** It is byte-identical to their own client and
  that is proven, not assumed.
- **Don't treat `call delivered` as success.** The wall is the only readout.
- **Don't enable the firewall without the safety net.** No physical access.
- **Don't change `QTECH_TICKET_ID_STYLE` or `QTECH_TIMESTAMP_FORMAT`** without
  a reason — they are deliberately set to match `call.bat` exactly.
- **Don't decompile `QTX_V5_70.jar`** without checking with Qtech first.

## 9. Further reading, all in `~/nexus-kiosk/display/docs/`

| File | What |
|---|---|
| `QTECH-PROTOCOL-ACTUAL.md` | The wire protocol as implemented, and what fire-and-forget costs |
| `INSTALL.md` | Full install and troubleshooting |
| `SUPABASE-SETUP.md` | The Supabase leg — the only one carrying a secret |
| `QTECH-TCP-QUESTIONS.md` | What Qtech still owe us |
| `handover.html` | The formal handover for Qtech and MWO |
| `qtech-reply-draft.md` | Correspondence drafts |
