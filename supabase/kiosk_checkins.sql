-- =============================================================================
-- kiosk_checkins — the unified queue table written by the kiosk app.
-- Nexus backend reads this table for queue display and processing.
-- =============================================================================

CREATE TABLE IF NOT EXISTS kiosk_checkins (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Check-in identity
  ref_code          TEXT NOT NULL,
  appointment_type  TEXT NOT NULL CHECK (appointment_type IN ('APPOINTMENT', 'FRA', 'WALKIN')),

  -- Queue assignment (written by kiosk)
  queue_number      INT NOT NULL,
  display_number    TEXT NOT NULL,
  queue_series      TEXT NOT NULL,
  service_type      TEXT,
  status            TEXT NOT NULL DEFAULT 'WAITING'
                    CHECK (status IN (
                      'PENDING','WAITING','CALLED','PROCESSING','SUBMITTED',
                      'CONFIRMED','PROCESSED','OR_ISSUED','MISSED','DEFERRED',
                      'RECEIVED','FAILED'
                    )),

  -- Client info (written by kiosk)
  client_name       TEXT,
  client_email      TEXT,
  appointment_id    UUID,
  transaction_ref   TEXT,
  queue_date        DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Nexus backend fields (NOT written by kiosk)
  assigned_to       TEXT,
  counter_number    INT,
  called_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,
  remarks           TEXT,
  deferral_reason   TEXT,
  error_message     TEXT
);

-- Prevent duplicate queue numbers per day per series
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosk_checkins_queue
  ON kiosk_checkins (queue_date, queue_number, queue_series);

CREATE INDEX IF NOT EXISTS idx_kiosk_checkins_ref ON kiosk_checkins (ref_code);
CREATE INDEX IF NOT EXISTS idx_kiosk_checkins_date ON kiosk_checkins (queue_date);
CREATE INDEX IF NOT EXISTS idx_kiosk_checkins_status ON kiosk_checkins (status);
CREATE INDEX IF NOT EXISTS idx_kiosk_checkins_series ON kiosk_checkins (queue_series);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_kiosk_checkins_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kiosk_checkins_updated_at ON kiosk_checkins;
CREATE TRIGGER trg_kiosk_checkins_updated_at
  BEFORE UPDATE ON kiosk_checkins
  FOR EACH ROW EXECUTE FUNCTION update_kiosk_checkins_updated_at();

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE kiosk_checkins;

-- RLS
ALTER TABLE kiosk_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY kiosk_checkins_anon_select ON kiosk_checkins
  FOR SELECT USING (true);

CREATE POLICY kiosk_checkins_service_all ON kiosk_checkins
  FOR ALL USING (true) WITH CHECK (true);
