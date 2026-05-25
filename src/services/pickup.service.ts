/**
 * Pickup eligibility resolver — decides whether a scanned/keyed reference code
 * should issue a normal check-in, a pickup ticket, or be rejected.
 *
 * All three pickup kinds (Appointment, FRA, Accreditation) share the regular
 * 6000-series queue and priority 3, but their tickets are tagged
 * `PICKUP — <SERVICE>` so the receptionist can see the intent at a glance.
 *
 * Cross-day re-scan is allowed for every kind — pickups have no
 * appointment_date gate and the source-of-truth row is never mutated by the
 * kiosk on a pickup write. The kiosk_checkins dedup (keyed on queue_date +
 * ref_code + remarks=PICKUP) blocks only same-day duplicates.
 *
 * Recognised pickup signals (mirrors the Nexus contract):
 *   • Appointments — status in {submitted, processed, or_issued}, OR
 *                    legacy DH past + appt_status='ARRIVED'
 *   • FRA          — status === 'or_issued' (only — OR must already exist)
 *   • Submissions  — trans_status in {submitted, processed, or_issued}
 */

import * as appointmentService from './appointment.service';
import * as submissionService from './submission.service';
import { isDhAppointment, todaySGT, resolveServiceLabel } from '../lib/constants';
import type { AppointmentWithService } from '../schemas/appointment.schema';
import type { FraRegistrationRow } from '../schemas/fra.schema';
import type { SubmissionRow } from '../schemas/submission.schema';

export type PickupKind = 'APPOINTMENT' | 'FRA' | 'ACCREDITATION';

export interface AppointmentPickup {
  readonly kind: 'APPOINTMENT';
  readonly appointment: AppointmentWithService;
  readonly clientName: string;
  readonly serviceLabel: string;
}

export interface AccreditationPickup {
  readonly kind: 'ACCREDITATION';
  readonly submission: SubmissionRow;
  readonly clientName: string;
}

export interface FraPickup {
  readonly kind: 'FRA';
  readonly fra: FraRegistrationRow;
  readonly clientName: string;
}

export type OfwPickup = AppointmentPickup | AccreditationPickup;
export type PickupResult = AppointmentPickup | AccreditationPickup | FraPickup;

/** Appointment statuses that route to pickup-mode in the new Supabase-reduction model. */
const APPOINTMENT_PICKUP_STATUSES: ReadonlySet<string> = new Set([
  'submitted',
  'processed',
  'or_issued',
]);

/** FRA row statuses that mean the worker is ready for pickup — OR must exist. */
const FRA_PICKUP_STATUSES: ReadonlySet<string> = new Set(['or_issued']);

/**
 * Evaluate an OFW/Employer reference code for pickup eligibility.
 *
 * Resolution order:
 *  1. Appointment exists AND status in {submitted, processed, or_issued} —
 *     post-Supabase-reduction signal that the client is returning for OR.
 *  2. Legacy DH past appointment with `appt_status='ARRIVED'`.
 *  3. Accreditation submission via fallback.
 *
 * Returns null when the code does not represent a pickup — caller should fall
 * through to the regular fresh check-in path.
 */
export async function evaluateOfwPickup(
  refCode: string,
  appointment?: AppointmentWithService | null,
): Promise<OfwPickup | null> {
  const today = todaySGT();
  const appt = appointment ?? (await appointmentService.lookupByRefCode(refCode));

  if (appt) {
    const apptStatus = (appt.status ?? '').toLowerCase();

    // (1) New status-driven pickup — any service whose appointment is in a
    // pickup-eligible status. The pickup ticket uses the appointment's actual
    // service label so the cashier still sees "PICKUP - DH" / "PICKUP - SKILLED
    // WORKER - CV" / etc.
    if (APPOINTMENT_PICKUP_STATUSES.has(apptStatus)) {
      const clientName = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
        .filter(Boolean)
        .join(' ');
      return {
        kind: 'APPOINTMENT',
        appointment: appt,
        clientName,
        serviceLabel: resolveServiceLabel(appt.service_id),
      };
    }

    // (2) Legacy DH branch — past appointment + appt_status='ARRIVED' was the
    // historical "OR is ready for pickup" signal before the new status model.
    const isPast = appt.appointment_date < today;
    const isDh = isDhAppointment(appt.service_id);
    if (isPast && isDh && appt.appt_status === 'ARRIVED') {
      const clientName = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
        .filter(Boolean)
        .join(' ');
      return {
        kind: 'APPOINTMENT',
        appointment: appt,
        clientName,
        serviceLabel: resolveServiceLabel(appt.service_id),
      };
    }

    return null; // appointment exists but not pickup-eligible — caller handles fresh path
  }

  // (3) No appointment — try accreditation submissions.
  const submission = await submissionService.lookupByRefCode(refCode);
  if (submission && submissionService.isPickupEligible(submission)) {
    return {
      kind: 'ACCREDITATION',
      submission,
      clientName: submissionService.resolveSubmissionName(submission),
    };
  }

  return null;
}

/**
 * Evaluate an FRA registration for pickup eligibility.
 *
 * Only `or_issued` qualifies — Nexus sets this on `fra_registrations.status`
 * after `batchIssueOr`, signalling the OR exists and the client may collect it.
 * Earlier post-processing states (`completed`, `submitted`) are intentionally
 * excluded: until the OR is issued, there is nothing to pick up.
 */
export function evaluateFraPickup(fra: FraRegistrationRow): FraPickup | null {
  if (!FRA_PICKUP_STATUSES.has(fra.status)) return null;
  return {
    kind: 'FRA',
    fra,
    clientName: fra.fra,
  };
}

/**
 * Service-line label printed on the pickup ticket.
 * For appointment pickups the actual service label (DH / Skilled CV / MDW)
 * is used so the cashier sees a meaningful tag instead of a generic word.
 */
export function pickupTicketLabel(pickup: PickupResult): string {
  if (pickup.kind === 'FRA') return 'PICKUP - FRA';
  if (pickup.kind === 'ACCREDITATION') return 'PICKUP - ACCREDITATION';
  return `PICKUP - ${pickup.serviceLabel.toUpperCase()}`;
}
