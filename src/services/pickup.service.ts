/**
 * Pickup eligibility resolver — decides whether a scanned/keyed reference code
 * should issue a normal check-in, a pickup ticket, or be rejected.
 *
 * All three pickup kinds (DH, FRA, Accreditation) share the regular 6000-series
 * queue and priority 3, but their tickets are tagged `PICKUP — <SERVICE>` so
 * the receptionist can see the intent at a glance.
 */

import * as appointmentService from './appointment.service';
import * as submissionService from './submission.service';
import { isDhAppointment, todaySGT, resolveServiceLabel } from '../lib/constants';
import type { AppointmentWithService } from '../schemas/appointment.schema';
import type { FraRegistrationRow } from '../schemas/fra.schema';
import type { SubmissionRow } from '../schemas/submission.schema';

export type PickupKind = 'DH' | 'FRA' | 'ACCREDITATION';

export interface DhPickup {
  readonly kind: 'DH';
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

export type OfwPickup = DhPickup | AccreditationPickup;
export type PickupResult = DhPickup | AccreditationPickup | FraPickup;

/**
 * Evaluate an OFW/Employer reference code for pickup eligibility.
 *
 * Resolution order (matches receptionist behaviour):
 *  1. DH past appointment with `appt_status='ARRIVED'` — client returning for OR.
 *  2. Accreditation submission with `trans_status='For Submission'`.
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
    const isPast = appt.appointment_date < today;
    const isDh = isDhAppointment(appt.service_id);
    if (isPast && isDh && appt.appt_status === 'ARRIVED') {
      const clientName = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
        .filter(Boolean)
        .join(' ');
      return {
        kind: 'DH',
        appointment: appt,
        clientName,
        serviceLabel: resolveServiceLabel(appt.service_id),
      };
    }
    return null; // appointment exists but not pickup-eligible — caller handles fresh path
  }

  // No appointment row — try accreditation submissions.
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
 * Evaluate an FRA transaction_ref for pickup eligibility.
 * The kiosk treats `fra_registrations.status === 'completed'` as the pickup
 * signal — that is the row state set by the Nexus backend after OR issuance.
 */
export function evaluateFraPickup(fra: FraRegistrationRow): FraPickup | null {
  if (fra.status !== 'completed') return null;
  return {
    kind: 'FRA',
    fra,
    clientName: fra.fra,
  };
}

/** Service-line label printed on the pickup ticket. */
export function pickupTicketLabel(kind: PickupKind): string {
  switch (kind) {
    case 'DH':
      return 'PICKUP - DH';
    case 'FRA':
      return 'PICKUP - FRA';
    case 'ACCREDITATION':
      return 'PICKUP - ACCREDITATION';
  }
}
