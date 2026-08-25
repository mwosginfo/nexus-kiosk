-- ============================================================================
-- Optional hardening: a least-privilege role for the bridge
--
-- WHY THIS EXISTS
--
-- The bridge touches three tables and reads ten columns of one of them:
--
--     select  kiosk_checkins        (10 columns, no personal data)
--     upsert  qtech_bridge_health   (its own heartbeat)
--     upsert  qtech_call_log        (its own outcome log)
--
-- The default instruction was to give it a service-role key. That key bypasses
-- row-level security entirely and grants full read and write across the whole
-- project — including `appointments`, which holds every client's name, email,
-- contact number and employer. The bridge reads none of that and never should.
--
-- This mattered less when the Pi sat on a trusted segment talking outbound to
-- a cloud endpoint over TLS. As of 2026-08-20 the Qtech link is plaintext on
-- the office LAN, which makes that LAN a less trusted place, not a more
-- trusted one. A device on it should hold the narrowest credential that does
-- the job.
--
-- HOW TO USE
--
--   1. Run this file in the Supabase SQL editor.
--   2. Dashboard -> Project Settings -> API Keys -> create a new secret key
--      bound to the `qtech_bridge` role.
--   3. Put that key in SUPABASE_KEY on the Pi, in place of the service-role
--      key, and restart the bridge.
--   4. Confirm it still works: the heartbeat should keep advancing and
--      qtech_bridge_status.state should stay OK.
--
-- VERIFY BEFORE APPLYING. This is written against the schema as documented;
-- it has not been run against the live project. In particular, check whether
-- `kiosk_checkins` has row-level security enabled — if it does, the policy at
-- the bottom is required; if it does not, the grant alone is sufficient.
-- ============================================================================

-- ── The role ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'qtech_bridge') then
    create role qtech_bridge nologin noinherit;
  end if;
end
$$;

-- PostgREST connects as `authenticator` and switches into the request role,
-- so it must be able to become this one.
grant qtech_bridge to authenticator;

grant usage on schema public to qtech_bridge;

-- ── Exactly what the bridge needs, and nothing else ────────────────────────
grant select                 on public.kiosk_checkins      to qtech_bridge;
grant select, insert, update on public.qtech_bridge_health to qtech_bridge;
grant select, insert, update on public.qtech_call_log      to qtech_bridge;
grant usage, select          on sequence public.qtech_call_log_id_seq to qtech_bridge;

-- Note what is absent: no access to appointments, fra_registrations,
-- submissions, services, or anything else. No delete anywhere. No schema
-- changes. If the Pi is lost or the key leaks, the blast radius is the queue
-- numbers already on a public display plus this bridge's own health log.

-- ── Row-level security ──────────────────────────────────────────────────────
-- The two qtech_* tables have RLS enabled with no policies (001), which denies
-- everything to a non-superuser role. These policies open them to this role
-- alone.
drop policy if exists qtech_bridge_health_rw on public.qtech_bridge_health;
create policy qtech_bridge_health_rw
  on public.qtech_bridge_health
  for all
  to qtech_bridge
  using (true)
  with check (true);

drop policy if exists qtech_call_log_rw on public.qtech_call_log;
create policy qtech_call_log_rw
  on public.qtech_call_log
  for all
  to qtech_bridge
  using (true)
  with check (true);

-- If, and only if, kiosk_checkins has RLS enabled, the bridge also needs to be
-- able to read it. Scoped to the current operating day, since it never looks
-- further back than that.
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'kiosk_checkins' and rowsecurity
  ) then
    drop policy if exists qtech_bridge_read_today on public.kiosk_checkins;
    create policy qtech_bridge_read_today
      on public.kiosk_checkins
      for select
      to qtech_bridge
      using (queue_date >= (now() at time zone 'Asia/Singapore')::date - 1);
  end if;
end
$$;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- The bridge subscribes to changes on kiosk_checkins. Confirm the table is in
-- the realtime publication; this is idempotent and harmless if already there.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kiosk_checkins'
  ) then
    alter publication supabase_realtime add table public.kiosk_checkins;
  end if;
end
$$;
