-- =============================================================================
-- next_queue_number() — Atomic queue number generation with advisory lock.
--
-- Uses pg_advisory_xact_lock to prevent race conditions across concurrent
-- kiosk instances. The lock is held only for the duration of the transaction.
--
-- Usage:
--   SELECT next_queue_number('2026-03-29', 'REGULAR', 6001);
--   → Returns: 6001 (if first of the day), 6002, 6003, ...
-- =============================================================================

CREATE OR REPLACE FUNCTION next_queue_number(
  p_queue_date   DATE,
  p_queue_series TEXT,
  p_start_number INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_key BIGINT;
  v_max      INT;
  v_next     INT;
BEGIN
  -- Generate a deterministic lock key from date + series
  -- This ensures different series don't block each other
  v_lock_key := hashtext(p_queue_date::TEXT || '::' || p_queue_series);

  -- Acquire advisory lock (released automatically at end of transaction)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Find the current max queue number for this date + series
  SELECT COALESCE(MAX(queue_number), p_start_number - 1)
  INTO v_max
  FROM kiosk_checkins
  WHERE queue_date = p_queue_date
    AND queue_series = p_queue_series;

  v_next := v_max + 1;

  -- Ensure we never go below start number
  IF v_next < p_start_number THEN
    v_next := p_start_number;
  END IF;

  RETURN v_next;
END;
$$;
