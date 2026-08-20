# Installation — Nexus→Qtech bridge on a Raspberry Pi

End-to-end runbook, from a blank Pi to a bridge Qtech can test against.

Roughly 30 minutes, most of it waiting for `apt` and `npm`.

---

## 0. Before you start

### What you need from Qtech

The bridge cannot be configured without these. Ask for them up front — items
1–4 are the Phase 0 deliverable in their acceptance procedure (§8).

| # | Item | Example |
|---|---|---|
| 1 | Tenant URL | `https://mwo.qtechqms.com` |
| 2 | `branchUUID` for the **test** branch | `c761bfe7-…` |
| 3 | Basic auth username + secret for the test branch | — |
| 4 | The counter names configured on the test branch | `1`–`10` |
| 5 | Later: the same four for the **production** branch | — |

### What Qtech needs from you

| Item | Value |
|---|---|
| Counter name list | `1`–`10` — Nexus caps counter assignment at 10 (`counter.controller.ts`). Their voice is pre-recorded and only announces numeric names |
| Queue number shapes | `6001` (CV/DH/ACC), `9001` (OWWA), `A004` (FRA), `W601` / `W901` / `WA01` (walk-ins). **Ask which prefixes have recorded audio** — their document only demonstrates `A045` |
| Egress IP | The office's public IP as seen from the Pi, if they adopt allow-listing. Get it with `curl -s https://api.ipify.org` **from the Pi** |
| Data set | Six fields, no personal data. `ticketID` is an opaque UUID |

### Hardware and network

- Raspberry Pi 3 or newer. **Pi OS Lite is enough** — the bridge is headless,
  with no display, browser, or desktop.
- Wired ethernet preferred.
- Outbound HTTPS (443) to the Qtech tenant **and** to your Supabase project.
- No inbound ports. The interface is one-way; the bridge listens on nothing.

---

## 1. Apply the database schema

Once per Supabase project, before the bridge first runs. Supabase dashboard →
SQL Editor → paste and run:

```
display/sql/001_qtech_bridge.sql
```

Creates `qtech_bridge_health`, `qtech_call_log`, and the `qtech_bridge_status`
view Nexus reads. RLS is on with no policies, so only the service role reaches
them. Re-running is safe.

Verify:

```sql
select * from qtech_bridge_status;   -- 0 rows until the bridge first beats
```

---

## 2. Prepare the Pi

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates
```

Set the clock to Singapore time. Queue dates are computed in SGT, and while the
bridge derives SGT itself rather than trusting the system zone, a correct clock
makes the journal readable:

```bash
sudo timedatectl set-timezone Asia/Singapore
timedatectl                       # check "System clock synchronized: yes"
```

Install Node 20 LTS or newer — Raspberry Pi OS ships something older:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v                           # must be v20.x or newer
```

---

## 3. Get the code

```bash
git clone --depth 1 https://github.com/mwosginfo/nexus-kiosk ~/nexus-kiosk
cd ~/nexus-kiosk/display
```

---

## 4. Install

```bash
sudo ./install.sh
```

The installer:

1. Checks Node is 20+.
2. Creates a locked-down `qtechbridge` system user (no shell, no home).
3. Runs `npm ci`, compiles TypeScript, then prunes the build tooling back out
   so only runtime dependencies reach `/opt`.
4. Copies the build to `/opt/nexus-qtech-bridge`.
5. Writes a credential template to `/etc/nexus-qtech-bridge.env` if none
   exists, `0640 root:qtechbridge`.
6. Installs and enables the systemd unit — **without starting it**, because
   the credentials are not filled in yet.

---

## 5. Configure

```bash
sudo nano /etc/nexus-qtech-bridge.env
```

The six that must be set:

```ini
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<service-role-or-equivalent-secret-key>

QTECH_BASE_URL=https://<tenant>.qtechqms.com/api/v1/ops
QTECH_USERNAME=<from Qtech>
QTECH_PASSWORD=<from Qtech>
QTECH_BRANCH_UUID=<from Qtech>
```

`QTECH_BASE_URL` **must** be `https://` and **must** include `/api/v1/ops`
with no trailing slash. The bridge refuses to start on a plain-HTTP URL —
Qtech does not offer HTTP, and a mistyped scheme would put the Basic secret on
the wire in clear.

Everything else has a working default. See `.env.example` for the full list.

> The file is not in git and never should be. Rotating the secret is an edit
> plus a restart — no rebuild, no redeploy. Qtech accepts old and new secrets
> for a 7-day overlap, so there is no need to time it precisely.

---

## 6. First run — dry run

Prove the Supabase half works before sending anything to a display.

```bash
sudo sed -i 's/^DRY_RUN=.*/DRY_RUN=true/' /etc/nexus-qtech-bridge.env
sudo systemctl start nexus-qtech-bridge
journalctl -u nexus-qtech-bridge -f
```

Expect, within a few seconds:

```json
{"msg":"starting nexus-qtech-bridge","dryRun":true, ...}
{"msg":"seeded call cache from current state","rows":N}
{"msg":"realtime subscribed","table":"kiosk_checkins"}
{"msg":"bridge running"}
```

Now have someone call a number at a counter in Nexus. You should see:

```json
{"msg":"dry-run: call suppressed","queueNo":"6001","counterName":"7"}
```

And from Supabase:

```sql
select state, heartbeat_age_seconds, sent_today, failed_today, blocked_today
from qtech_bridge_status;
```

`state` should read `OK`. If it says `DEGRADED`, check `last_error_code`.

---

## 7. Go live

```bash
sudo sed -i 's/^DRY_RUN=.*/DRY_RUN=false/' /etc/nexus-qtech-bridge.env
sudo systemctl restart nexus-qtech-bridge
sudo systemctl enable nexus-qtech-bridge     # already enabled by the installer
```

Confirm it survives a reboot — this is the one failure that is invisible until
the day the power blinks:

```bash
sudo reboot
# after it comes back:
systemctl status nexus-qtech-bridge
```

---

## 8. Driving Qtech's acceptance tests

Their §8 requires calls driven from our system. Doing that through the live
queue would mean calling real clients, so use the conformance CLI. It sends one
call with the same credentials and payload builder the bridge uses, and prints
the raw request and response.

```bash
cd /opt/nexus-qtech-bridge
sudo env $(grep -v '^#' /etc/nexus-qtech-bridge.env | xargs) \
  node dist/src/cli/send-call.js --help
```

Define a shortcut for the rest of this section:

```bash
qcall() {
  sudo env $(grep -v '^#' /etc/nexus-qtech-bridge.env | xargs) \
    node /opt/nexus-qtech-bridge/dist/src/cli/send-call.js "$@"
}
```

It exits `0` only on a genuine success — a business error arrives inside an
HTTP 200, so status alone is not the outcome.

### Phase 1 — interface conformance

```bash
qcall --health                                   # liveness
qcall --queue A045 --counter 7                   # happy path
qcall --queue A045 --counter 999                 # expect COUNTER_UNKNOWN
```

For `BRANCH_NOT_FOUND` and `VALIDATION_ERROR`, temporarily point
`QTECH_BRANCH_UUID` at a bogus value, or ask Qtech to provoke them their side.

### Phase 2 — end-to-end display

```bash
qcall --queue 6001 --counter 7                   # idle counter
qcall --queue 6002 --counter 7                   # replaces the first
qcall --queue 6003 --counter 3 & qcall --queue 6004 --counter 5 &   # concurrent
qcall --queue 6002 --counter 7                   # repeat -> re-announces
```

Exit criteria: correct number and counter within 2 seconds, chime and voice on
every call.

### Phase 3 — failure injection

```bash
# Duplicate: same eventId twice -> second returns duplicate:true, no announce
EV=$(uuidgen)
qcall --queue 6005 --counter 7 --event "$EV"
qcall --queue 6005 --counter 7 --event "$EV"

# Recall: same ticket, NEW eventId -> re-announces
TK=$(uuidgen)
qcall --queue 6006 --counter 7 --ticket "$TK"
qcall --queue 6006 --counter 7 --ticket "$TK"

# Silent: updates the display without chime or voice
qcall --queue 6007 --counter 7 --silent

# Link severed: display must hold last state, not blank
sudo systemctl stop nexus-qtech-bridge
#   ... confirm the wall is unchanged ...
sudo systemctl start nexus-qtech-bridge

# Unauthenticated: expect a clean rejection, no service impact
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$(grep QTECH_BASE_URL /etc/nexus-qtech-bridge.env | cut -d= -f2-)/call" \
  -H 'Content-Type: application/json' -d '{}'
```

While the bridge is stopped, `qtech_bridge_status.state` should go `DOWN`
within 90 seconds. That is the silent-failure detection working — worth
demonstrating, since it is the thing that tells staff the wall may be stale.

### Phase 4 — pilot

Five business days on one counter. The daily review comes from:

```sql
select outcome, count(*), max(created_at)
from qtech_call_log
where created_at >= current_date
group by outcome;
```

---

## 9. Day-to-day operations

```bash
systemctl status nexus-qtech-bridge
journalctl -u nexus-qtech-bridge -f            # live
journalctl -u nexus-qtech-bridge -p warning    # problems only
journalctl -u nexus-qtech-bridge --since today
sudo systemctl restart nexus-qtech-bridge
```

Logs are one JSON object per line and carry ids, queue numbers and counters
only — never names, emails, or ref codes.

### Deploying an update

```bash
cd ~/nexus-kiosk && git pull
cd display && sudo ./install.sh
sudo systemctl restart nexus-qtech-bridge
```

`/etc/nexus-qtech-bridge.env` is left alone by the installer.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Exits immediately, `must use https://` | `QTECH_BASE_URL` is `http://` | Correct the scheme |
| Exits immediately, `NODE_TLS_REJECT_UNAUTHORIZED=0` | Certificate validation disabled | Unset it — Qtech item 7.1 requires validation |
| Exits immediately, ZodError | A required variable is missing or malformed | The error names the field |
| `realtime channel state` warnings, never `subscribed` | Realtime blocked or the key lacks access | Check the firewall allows WSS to Supabase; confirm the key |
| `state = DEGRADED`, `last_error_code = AUTH_FAILED` | Wrong username or secret, or rotated | Re-enter the credentials, restart |
| `state = DEGRADED`, `COUNTER_UNKNOWN` | A counter name is not on Qtech's list | Reconcile `QTECH_ALLOWED_COUNTERS` with the agreed list; notify Qtech before adding |
| `blocked_today` climbing, `COUNTER_MISSING` | Staff calling without assigning a counter in Nexus | Nexus-side process issue, not the bridge |
| `state = DOWN` | No heartbeat for 90s — process dead, Pi off, or no network | `systemctl status`, then the journal |
| Calls appear on the wall but late | A retry is holding that counter's queue | Check `qtech_call_log` for `FAILED` rows |
| `recovered_by_poll_today` climbing while `realtime_connected` is true | The Realtime subscription has silently died | Restart the bridge; the reconcile poll is covering meanwhile, so no calls are lost |

### Full reset

```bash
sudo systemctl stop nexus-qtech-bridge
sudo rm -rf /opt/nexus-qtech-bridge
cd ~/nexus-kiosk/display && sudo ./install.sh
sudo systemctl start nexus-qtech-bridge
```

The credential file and the Supabase tables survive.

---

## 11. Handover checklist

Before handing to Qtech:

- [ ] `sql/001_qtech_bridge.sql` applied; `qtech_bridge_status` returns a row
- [ ] Bridge installed, enabled, and survives a reboot
- [ ] `state = OK` with a heartbeat age under 30 seconds
- [ ] A real Nexus call reached the test branch (or `dry-run: call suppressed`
      seen in the journal)
- [ ] Counter list agreed and matching `QTECH_ALLOWED_COUNTERS`
- [ ] Egress IP captured from the Pi, if allow-listing is adopted
- [ ] Production credentials stored somewhere durable — the Pi is the only
      copy otherwise

Open questions to settle with Qtech: see `docs/QTECH-CONFORMANCE.md`.

**Still outstanding on our side:** their item 9 asks for an operator-visible
alert when a call fails after its final retry. The bridge detects and records
this and exposes it as `qtech_bridge_status.state`, but the Nexus badge that
would put it in front of counter staff has not been built. That is a Nexus
change, not a bridge change, and should be closed before Phase 5 sign-off.
