-- ============================================================================
-- Nexus ↔ Qtech bridge — health + audit surface
--
-- Purpose: give Nexus a way to detect that the bridge has SILENTLY failed,
-- without the bridge ever connecting to Nexus. The bridge writes here; Nexus
-- reads here. Supabase is the only thing they share.
--
-- The failure modes this is designed to expose are the quiet ones — the ones
-- that produce no error anywhere because nothing is running to produce it:
--
--   1. Pi powered off / process dead / SD card gone   → heartbeat goes stale
--   2. Realtime socket silently dropped (open socket, → realtime_connected
--      no events arriving — the classic failure)          false
--   3. Qtech unreachable, or auth rejected            → consecutive_failures
--   4. Qtech answering 200 with response:"Error"      → last_error_code
--      (succeeds at HTTP level, fails at business     (COUNTER_UNKNOWN etc.)
--       level — the quietest failure of all)
--   5. Calls arriving with no counter assigned        → blocked_today
--
-- NO PERSONAL DATA. Ticket ids are opaque UUIDs; names, emails and ref codes
-- are never written here, matching the Qtech data-minimisation position (§6).
-- ============================================================================

-- ── Health: one row per bridge instance, rewritten on every heartbeat ───────
create table if not exists public.qtech_bridge_health (
  bridge_id                text        primary key,
  updated_at               timestamptz not null default now(),
  started_at               timestamptz not null,
  version                  text        not null,

  -- Supabase side
  realtime_connected       boolean     not null default false,
  realtime_last_event_at   timestamptz,
  reconcile_last_run_at    timestamptz,

  -- Qtech side
  qtech_health_ok          boolean,
  qtech_health_checked_at  timestamptz,
  last_call_sent_at        timestamptz,
  last_call_error_at       timestamptz,
  last_error_code          text,
  last_error_message       text,
  consecutive_failures     integer     not null default 0,

  -- Counters for the current operating day (SGT), reset at rollover
  stats_date               text,
  sent_today               integer     not null default 0,
  failed_today             integer     not null default 0,
  blocked_today            integer     not null default 0,
  duplicate_today          integer     not null default 0,
  -- Calls that Realtime never delivered and the reconcile poll had to find.
  -- A rising count while realtime_connected is true is the fingerprint of a
  -- silently-dead subscription (failure mode 2).
  recovered_by_poll_today  integer     not null default 0,

  dry_run                  boolean     not null default false
);

comment on table public.qtech_bridge_health is
  'Heartbeat + last-known state of the Nexus→Qtech call bridge. Written by the bridge, read by Nexus. Staleness of updated_at is the primary silent-failure signal.';

-- ── Call log: append-only, one row per delivery attempt outcome ─────────────
create table if not exists public.qtech_call_log (
  id             bigserial   primary key,
  created_at     timestamptz not null default now(),
  bridge_id      text        not null,
  event_id       uuid        not null,
  ticket_id      text        not null,
  queue_no       text        not null,
  counter_name   text,
  outcome        text        not null
                 check (outcome in ('SENT','DUPLICATE','FAILED','BLOCKED','DRY_RUN')),
  attempts       integer     not null default 0,
  http_status    integer,
  qtech_code     text,
  error_message  text,
  latency_ms     integer,
  silent         boolean     not null default false
);

comment on table public.qtech_call_log is
  'Append-only outcome log for every call the bridge attempted to deliver to Qtech. No personal data: ticket_id is an opaque kiosk_checkins UUID.';

create index if not exists qtech_call_log_created_at_idx
  on public.qtech_call_log (created_at desc);
create index if not exists qtech_call_log_outcome_idx
  on public.qtech_call_log (outcome, created_at desc);
-- One row per (event, attempt-outcome); makes the log safe to re-write on retry.
create unique index if not exists qtech_call_log_event_id_key
  on public.qtech_call_log (event_id);

-- ── The single thing Nexus needs to read ───────────────────────────────────
--
-- Collapses every failure mode above into one `state` string so the Nexus side
-- is a single SELECT and one badge, with no policy logic duplicated there.
--
--   OK        — heartbeat fresh, Realtime up, Qtech answering, no error streak
--   DEGRADED  — bridge alive but not delivering reliably
--   DOWN      — no heartbeat for 90s (six missed beats): assume nothing is
--               reaching the wall
--
create or replace view public.qtech_bridge_status as
select
  h.bridge_id,
  h.updated_at,
  h.started_at,
  h.version,
  h.realtime_connected,
  h.realtime_last_event_at,
  h.reconcile_last_run_at,
  h.qtech_health_ok,
  h.qtech_health_checked_at,
  h.last_call_sent_at,
  h.last_call_error_at,
  h.last_error_code,
  h.last_error_message,
  h.consecutive_failures,
  h.stats_date,
  h.sent_today,
  h.failed_today,
  h.blocked_today,
  h.duplicate_today,
  h.recovered_by_poll_today,
  h.dry_run,
  extract(epoch from (now() - h.updated_at))::integer as heartbeat_age_seconds,
  case
    when now() - h.updated_at > interval '90 seconds'         then 'DOWN'
    when h.realtime_connected is not true                     then 'DEGRADED'
    when h.qtech_health_ok is false                           then 'DEGRADED'
    when h.consecutive_failures >= 3                          then 'DEGRADED'
    else 'OK'
  end as state
from public.qtech_bridge_health h;

comment on view public.qtech_bridge_status is
  'Read this from Nexus. state = OK | DEGRADED | DOWN. DOWN means no heartbeat for 90s — the wall is almost certainly stale.';

-- ── Access control ─────────────────────────────────────────────────────────
-- RLS on with no policies: only the service role (which bypasses RLS) can
-- touch these. The bridge and Nexus both hold a service key; the kiosk anon
-- key and any browser client get nothing.
alter table public.qtech_bridge_health enable row level security;
alter table public.qtech_call_log      enable row level security;

revoke all on public.qtech_bridge_health from anon, authenticated;
revoke all on public.qtech_call_log      from anon, authenticated;
revoke all on public.qtech_bridge_status from anon, authenticated;
