# The Supabase link — setup and verification

Since Qtech moved on-premises with no TLS and no authentication, **this is the
only leg of the bridge that crosses the internet, and the only one carrying a
secret.** It is now the whole of the bridge's security boundary. Worth getting
right.

```
Nexus ──► Supabase ──► bridge ──► Qtech
          └── internet ──┘   └─ office LAN, plaintext ─┘
              TLS + key            no TLS, no auth
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

The bridge reads none of that. On a device sharing a LAN with equipment we now
speak to in plaintext, it should not be able to.

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

No calls reach the display, because no calls reach the bridge. This is worth
being explicit about, since it is now a wholly avoidable dependency between two
systems in the same building — see the note at the end.

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

With Qtech on the premises, a call now travels from Nexus (office LAN) out to
Supabase in Singapore, back to the Pi (office LAN), and across to the Qtech
equipment (office LAN). Three of those four points are in the same building.

Two consequences worth registering:

**Latency.** Qtech's Phase 2 exit criterion is that the display updates within
two seconds of a call. The mirror from Nexus to Supabase alone can take up to
two seconds before any network time is counted. This should be measured during
the pilot rather than assumed.

**Availability.** If the office internet drops, the queue display stops
updating even though Nexus and the Qtech equipment are both healthy and
reachable from each other over the local switch.

Keeping the bridge on Supabase only was a deliberate decision, made when Qtech
was a cloud service and the round trip was unavoidable. That reasoning does not
survive the move on-premises unchanged. Nothing needs to happen today, and the
current design works — but if the pilot shows latency near the two-second
threshold, or if an internet outage takes the display down during business
hours, a direct local path from Nexus to the bridge is worth revisiting.
