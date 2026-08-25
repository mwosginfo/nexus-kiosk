# The Supabase link — setup and verification

Since Qtech moved on-premises with no TLS and no authentication, **this is the
only leg of the bridge that crosses the internet, and the only one carrying a
secret.** It is now the whole of the bridge's security boundary. Worth getting
right.

```
Nexus ──────────► Supabase ──────────► bridge ──► Qtech
  MWO LAN            internet            PE LAN, plaintext
                  TLS + secret key       no TLS, no auth
```

---

## 1. Transport

Enforced in code as of this change: `SUPABASE_URL` **must** be `https://`. The
bridge refuses to start otherwise, and the private-address exemption that
allows the plaintext Qtech link deliberately does not apply here. A secret
crossing the internet gets TLS; there is no configuration that turns that off.

Verify:

```bash
grep SUPABASE_URL /etc/nexus-qtech-bridge.env    # must begin https://
```

## 2. The key — narrow it

The bridge touches three tables:

| Table | Access needed |
|---|---|
| `kiosk_checkins` | read, 10 columns, no personal data |
| `qtech_bridge_health` | read and write its own heartbeat |
| `qtech_call_log` | append its own outcomes |

A service-role key grants far more than that: it bypasses row-level security
across the entire project, including `appointments`, which holds every
client's name, email address, contact number and employer.

The bridge reads none of that. The Pi sits on the PE network alongside vendor
equipment, on a segment MWO does not exclusively control, and speaks to that
equipment in plaintext. A device in that position should hold the narrowest
credential that does the job — not one that can read every client record.

**Recommended:** apply `sql/002_bridge_role.sql`, create a secret API key bound
to the `qtech_bridge` role, and use that as `SUPABASE_KEY`. If the Pi is lost
or the key leaks, the exposure is limited to queue numbers already visible on
a public display, plus the bridge's own health log.

**If you keep the service-role key** for now, that is a decision rather than an
oversight — record it, and treat physical access to the Pi as equivalent to
database access to every client record.

## 3. Realtime

The bridge subscribes to changes on `kiosk_checkins`. Confirm the table is in
the realtime publication (the migration in step 2 does this, and is safe to
re-run):

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'kiosk_checkins';
```

If Realtime is unavailable the bridge does not stop working. The 15-second
reconcile poll picks up every call regardless; announcements simply arrive
later. The health row reports `realtime_connected = false`, and
`recovered_by_poll_today` climbing is the signal that the subscription is
failing while still appearing connected.

## 4. Key storage on the Pi

```bash
ls -l /etc/nexus-qtech-bridge.env      # expect -rw-r----- root qtechbridge
```

Read by systemd before privileges are dropped. Not in git, not in the code,
not in the service definition. Rotating is an edit and a restart.

## 5. Firewall

The Qtech leg is now local, which means the Pi's outbound internet access can
be narrowed to one destination:

| Direction | Destination | Port | Why |
|---|---|---|---|
| Outbound | Supabase project host | 443 | The only internet dependency |
| Outbound | Qtech equipment | LAN, per their spec | Plaintext, stays in the building |
| Inbound | none | — | The bridge listens on nothing |

If you were previously allowing general outbound HTTPS for the Qtech cloud
endpoint, that allowance can be removed.

## 6. When Supabase is unreachable

No calls reach the display, because no calls reach the bridge. Supabase is the
only path between the MWO network and the PE network, so there is no local
fallback — see the note at the end.

Behaviour during an outage:

- Reads fail and are retried on the next poll. Nothing is lost; a call made
  during the outage is picked up when connectivity returns, though by then it
  may be stale.
- Health writes fail, so the row stops advancing and Nexus reports `DOWN`
  after 90 seconds — correctly, since calls genuinely are not reaching the
  display.
- The bridge does not exit or need restarting. It recovers on its own.

## 7. Verification

After any change to this leg:

```bash
sudo systemctl restart nexus-qtech-bridge
journalctl -u nexus-qtech-bridge -f
```

Expect `seeded call cache from current state`, then `realtime subscribed`,
then `bridge running`. Then from Supabase:

```sql
select state, heartbeat_age_seconds, realtime_connected,
       sent_today, failed_today, recovered_by_poll_today
from qtech_bridge_status;
```

`state` should read `OK` and `heartbeat_age_seconds` should stay under 30.

A useful negative test: revoke the key, restart, and confirm the state goes
`DOWN` rather than the bridge silently pretending to work. Then restore it.

---

## A note on the topology

Nexus and the bridge are on **separate networks**. Nexus sits on the MWO
office LAN; the bridge, the Qtech equipment and the display sit on the PE
network. There is no local path between them, so Supabase is not an incidental
hop that could be optimised away — it is the only thing connecting the two
sides, and the design depends on it.

```
MWO LAN            internet            PE LAN
Nexus  ──────────► Supabase ─────────► Bridge ──local──► Qtech ──► Display
(internet)         (Singapore)         (internet)        (internet)  (no internet)
```

Two consequences follow, neither of which has a local workaround.

**Latency has a budget, and most of it is spent before the bridge sees
anything.** Qtech's Phase 2 criterion is a display update within two seconds of
a call. Approximate contributions:

| Step | Typical | Worst |
|---|---|---|
| Nexus writes the call locally | instant | instant |
| Nexus mirrors it to Supabase (2-second cron) | ~1s | 2s |
| Supabase receives the write | ~0.1s | ~0.3s |
| Supabase notifies the bridge | ~0.1s | ~0.3s |
| Bridge sends to Qtech over the LAN | <0.01s | <0.05s |
| **Total before Qtech receives it** | **~1.2s** | **~2.6s** |

The dominant term is the Nexus-side mirror, which runs on a two-second cycle.
The bridge contributes a small fraction and cannot go faster than the data
reaching it.

Measure this during the pilot rather than assuming it passes. If it fails, the
place to look is the Nexus mirror cadence — a change in the `nexus` repository,
not here.

**Both networks need internet for the display to update.** If either the MWO
LAN or the PE network loses connectivity, calls stop arriving. Supabase itself
is a third dependency. Nothing in this design can fall back to a local path,
because there isn't one.

The display machine itself has no internet access, which is a good thing: it
depends only on the Qtech equipment beside it on the PE network.
