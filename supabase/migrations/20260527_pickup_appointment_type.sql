-- =============================================================================
-- Allow appointment_type='PICKUP' on kiosk_checkins.
--
-- Pickup tickets (DH / FRA / Accreditation client returning to collect OR)
-- previously rode the 'APPOINTMENT' value with remarks='PICKUP'. The kiosk
-- now writes them as a dedicated type so the receptionist console can filter
-- pickups without parsing the free-text remarks column.
-- =============================================================================

ALTER TABLE kiosk_checkins
  DROP CONSTRAINT IF EXISTS kiosk_checkins_appointment_type_check;

ALTER TABLE kiosk_checkins
  ADD CONSTRAINT kiosk_checkins_appointment_type_check
  CHECK (appointment_type IN ('APPOINTMENT', 'FRA', 'WALKIN', 'PICKUP'));
