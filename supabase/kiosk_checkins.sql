-- ═══════════════════════════════════════════════════════════════════════════
-- kiosk_checkins — Supabase bridge table for kiosk → Nexus queue assignment
--
-- Flow:
--   1. Kiosk INSERTs a row (ref_code, appointment_type) with status = PENDING
--   2. Nexus Realtime listener picks up the INSERT
--   3. Nexus generates queue number, UPDATEs the row (queue_number, display_number, etc.)
--   4. Kiosk subscribes to Realtime for the UPDATE → prints ticket
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists kiosk_checkins (
  id              uuid primary key default gen_random_uuid(),
  ref_code        text not null,
  appointment_type text not null
    check (appointment_type in ('APPOINTMENT', 'FRA')),

  -- Filled by Nexus after processing
  queue_number    int,                    -- raw queue number (e.g., 6001, 1)
  display_number  text,                   -- formatted for ticket (e.g., '6001', 'A001', 'W601')
  queue_series    text,                   -- 'REGULAR', 'OWWA', 'FRA'
  service_type    text,                   -- Prisma ServiceType value for reference

  status          text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSED', 'FAILED')),
  error_message   text,                   -- populated on FAILED

  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);

-- Index for Nexus listener: quickly find unprocessed rows
create index if not exists idx_kiosk_checkins_pending
  on kiosk_checkins (status) where status = 'PENDING';

-- Index for cleanup queries
create index if not exists idx_kiosk_checkins_created_at
  on kiosk_checkins (created_at);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table kiosk_checkins enable row level security;

-- Kiosk (anon key) can insert new check-in requests
create policy "kiosk_insert" on kiosk_checkins
  for insert with check (true);

-- Kiosk can read rows (to get the result via Realtime or polling)
create policy "kiosk_read" on kiosk_checkins
  for select using (true);

-- Service role (Nexus backend) bypasses RLS and can UPDATE — no extra policy needed.

-- ─── Enable Realtime ────────────────────────────────────────────────────────
-- Run this in the Supabase SQL editor to enable Realtime for the table:
alter publication supabase_realtime add table kiosk_checkins;

-- ─── Cleanup: auto-delete rows older than 24 hours ──────────────────────────
-- Option A: pg_cron (if available in your Supabase plan)
-- select cron.schedule('cleanup-kiosk-checkins', '0 3 * * *',
--   $$delete from kiosk_checkins where created_at < now() - interval '24 hours'$$
-- );
-- Option B: manual cleanup via a daily Nexus cron job (implemented in kiosk-bridge)
