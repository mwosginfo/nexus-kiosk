import { useState } from 'react';
import { QueueNumberDisplay } from '../../components/QueueNumberDisplay';
import {
  resolveServiceLabel,
  todaySGT,
  isFutureDate,
  isWithinDaysAhead,
  SERVICE_ID_MAP,
} from '../../lib/constants';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as queueService from '../../services/queue.service';
import * as submissionService from '../../services/submission.service';
import { FraPickupSubmitModal } from './FraPickupSubmitModal';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';
import type { SubmissionRow } from '../../schemas/submission.schema';

type SelectedItem =
  | { readonly type: 'appointment'; readonly data: AppointmentWithService }
  | { readonly type: 'fra'; readonly data: FraRegistrationRow }
  | { readonly type: 'submission'; readonly data: SubmissionRow };

interface CheckinPanelProps {
  readonly selected: SelectedItem | null;
  readonly lastCheckin: { queueNumber: string; name: string } | null;
  readonly onCheckinComplete: (queueNumber: string, name: string) => void;
  readonly autoPrint: boolean;
}

interface PendingFraDispatch {
  readonly fra: FraRegistrationRow;
  readonly pickupContracts: readonly FraRegistrationRow[];
  readonly deferredContracts: readonly FraRegistrationRow[];
}

const DH_SERVICE_ID = SERVICE_ID_MAP['DH'];

/** Status values that route to pickup-mode in the new Supabase-reduction model. */
const APPOINTMENT_PICKUP_STATUSES: ReadonlyArray<string> = [
  'submitted',
  'processed',
  'or_issued',
];

function isDhAppointment(serviceId: string): boolean {
  return serviceId === DH_SERVICE_ID;
}

function isWithin14DaysBack(dateStr: string): boolean {
  const today = todaySGT();
  if (dateStr > today) return false;
  const sgtNow = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  sgtNow.setUTCDate(sgtNow.getUTCDate() - 14);
  const cutoff = sgtNow.toISOString().slice(0, 10);
  return dateStr >= cutoff;
}

export function CheckinPanel({
  selected,
  lastCheckin,
  onCheckinComplete,
  autoPrint,
}: CheckinPanelProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [pendingFra, setPendingFra] = useState<PendingFraDispatch | null>(null);

  // ─── Print + complete helpers ───────────────────────────────────────

  function maybePrint(queueNumber: string, name: string, serviceLabel: string) {
    if (!autoPrint) return;
    window.electronAPI.printTicket({
      queueNumber,
      clientName: name,
      serviceType: serviceLabel,
    }).catch((err: unknown) => console.error('[CheckinPanel] Print error:', err));
  }

  // ─── Appointment dispatch ─────────────────────────────────────────────────

  async function checkinAppointment(
    appt: AppointmentWithService,
    forceWalkIn: boolean,
  ): Promise<void> {
    const today = todaySGT();
    const isFuture = isFutureDate(appt.appointment_date);
    const isPast = appt.appointment_date < today;
    const isDh = isDhAppointment(appt.service_id);
    const apptStatus = appt.appt_status; // ARRIVED, DEFERRED, etc.
    const status = (appt.status ?? '').toLowerCase();

    // Block terminal/abnormal statuses
    const rejected = ['cancelled', 'no_show', 'released'];
    if (rejected.includes(status)) {
      throw new Error(`This appointment is ${status} and cannot be checked in.`);
    }

    // Future > 14 days
    if (isFuture && !isWithinDaysAhead(appt.appointment_date, 14)) {
      throw new Error(`Appointment is for ${appt.appointment_date}, which is more than 14 days ahead.`);
    }

    const serviceInfo = await appointmentService.lookupServiceInfo(appt.service_id);
    const name = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
      .filter(Boolean)
      .join(' ');
    const serviceLabel = resolveServiceLabel(appt.service_id);

    // ── New pickup-mode (status-driven): client returning for OR ──
    // Pickup applies only to DH appointments — CV (Skilled/MDW) has no
    // pickup step. No kiosk_checkins dedup — eligibility is keyed off the
    // appointment status.
    if (isDh && APPOINTMENT_PICKUP_STATUSES.includes(status)) {
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: appt.ref_code,
        appointmentType: 'PICKUP',
        queueSeries: serviceInfo.series,
        serviceType: serviceInfo.serviceType,
        clientName: name,
        clientEmail: appt.client_email,
        appointmentId: appt.id,
        transactionRef: appt.ref_code,
      });
      onCheckinComplete(assignment.displayNumber, name);
      maybePrint(assignment.displayNumber, name, `PICKUP - ${serviceLabel}`);
      return;
    }

    // ── Future flow: Approve & Check In as Walk-in (W600 series) ──
    if (isFuture || forceWalkIn) {
      const dup = await queueService.checkDuplicate(appt.ref_code);
      if (dup) throw new Error(`Already checked in as Q#${dup.displayNumber}.`);
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: appt.ref_code,
        appointmentType: 'WALKIN',
        queueSeries: 'WALKIN_REGULAR',
        serviceType: serviceInfo.serviceType,
        clientName: name,
        clientEmail: appt.client_email,
        appointmentId: appt.id,
        transactionRef: appt.ref_code,
        remarks: 'FUTURE_APPROVED',
      });
      appointmentService.markArrived(appt.id).catch(() => {});
      onCheckinComplete(assignment.displayNumber, name);
      maybePrint(assignment.displayNumber, name, serviceLabel);
      return;
    }

    // ── Past + DH pickup (legacy: any past date, appt_status='ARRIVED') ──
    if (isPast && isDh && apptStatus === 'ARRIVED') {
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: appt.ref_code,
        appointmentType: 'PICKUP',
        queueSeries: serviceInfo.series,
        serviceType: serviceInfo.serviceType,
        clientName: name,
        clientEmail: appt.client_email,
        appointmentId: appt.id,
        transactionRef: appt.ref_code,
      });
      onCheckinComplete(assignment.displayNumber, name);
      maybePrint(assignment.displayNumber, name, `PICKUP - ${serviceLabel}`);
      return;
    }

    // ── Past + DH deferred (within 14 days, appt_status='DEFERRED') ──
    if (isPast && isDh && apptStatus === 'DEFERRED') {
      if (!isWithin14DaysBack(appt.appointment_date)) {
        throw new Error(`Deferred appointment is older than 14 days (${appt.appointment_date}).`);
      }
      const dup = await queueService.checkDuplicate(appt.ref_code);
      if (dup) throw new Error(`Already checked in as Q#${dup.displayNumber}.`);
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: appt.ref_code,
        appointmentType: 'APPOINTMENT',
        queueSeries: serviceInfo.series,
        serviceType: serviceInfo.serviceType,
        clientName: name,
        clientEmail: appt.client_email,
        appointmentId: appt.id,
        transactionRef: appt.ref_code,
        apptStartTime: appt.start_time,
        remarks: 'DEFERRED',
      });
      appointmentService.markArrivedFromDeferred(appt.id).catch(() => {});
      onCheckinComplete(assignment.displayNumber, name);
      maybePrint(assignment.displayNumber, name, serviceLabel);
      return;
    }

    // ── Default flow: today (or past CV/OWWA) → normal check-in ──
    const dup = await queueService.checkDuplicate(appt.ref_code);
    if (dup) throw new Error(`Already checked in as Q#${dup.displayNumber}.`);
    const assignment = await queueService.checkinAndAssignQueue({
      refCode: appt.ref_code,
      appointmentType: 'APPOINTMENT',
      queueSeries: serviceInfo.series,
      serviceType: serviceInfo.serviceType,
      clientName: name,
      clientEmail: appt.client_email,
      appointmentId: appt.id,
      transactionRef: appt.ref_code,
      apptStartTime: appt.start_time,
    });
    appointmentService.markArrived(appt.id).catch(() => {});
    onCheckinComplete(assignment.displayNumber, name);
    maybePrint(assignment.displayNumber, name, serviceLabel);
  }

  // ─── FRA dispatch ─────────────────────────────────────────────────────────

  async function checkinFra(fra: FraRegistrationRow): Promise<void> {
    const today = todaySGT();
    const isFuture = fra.appointment_date > today;
    const isPast = fra.appointment_date < today;

    if (fra.status === 'cancelled') {
      throw new Error('This FRA registration is cancelled and cannot be checked in.');
    }
    if (fra.status === 'moved') {
      throw new Error('This FRA group has been split. Please use the new printed QR.');
    }

    // ── Future or today: normal A001 flow (first-visit dup check) ──
    if (isFuture || !isPast) {
      const dup = await queueService.checkDuplicate(fra.transaction_ref);
      if (dup) throw new Error(`Already checked in as Q#${dup.displayNumber}.`);
      await issueFraQueue(fra, fra.transaction_ref, isFuture ? 'FUTURE_APPROVED' : undefined);
      fraService.markArrived(fra.transaction_ref).catch(() => {});
      return;
    }

    // ── Past: analyze contracts ──
    const contracts = await fraService.getGroupContracts(fra.transaction_ref);
    const analysis = fraService.analyzeFraGroup(contracts);

    const hasPickup = analysis.pickupContracts.length > 0;
    const hasDeferred = analysis.deferredContracts.length > 0;
    const hasMoved = analysis.movedContracts.length > 0;
    const onlyMoved =
      hasMoved &&
      !hasPickup &&
      !hasDeferred &&
      analysis.otherContracts.length === 0;

    if (onlyMoved) {
      throw new Error('This FRA group has been split. Please use the new printed QR.');
    }

    // Mixed pickup + deferred: prompt receptionist
    if (hasPickup && hasDeferred) {
      if (!isWithin14DaysBack(fra.appointment_date)) {
        // Past > 14 days — only pickup is allowed, skip modal
        await dispatchFraPickup(fra, analysis.pickupContracts);
        return;
      }
      setPendingFra({
        fra,
        pickupContracts: analysis.pickupContracts,
        deferredContracts: analysis.deferredContracts,
      });
      return;
    }

    if (hasPickup) {
      await dispatchFraPickup(fra, analysis.pickupContracts);
      return;
    }

    if (hasDeferred) {
      if (!isWithin14DaysBack(fra.appointment_date)) {
        throw new Error(`Deferred FRA registration is older than 14 days (${fra.appointment_date}).`);
      }
      await dispatchFraDeferred(fra, analysis.deferredContracts);
      return;
    }

    // No special state → default check-in
    const dup = await queueService.checkDuplicate(fra.transaction_ref);
    if (dup) throw new Error(`Already checked in as Q#${dup.displayNumber}.`);
    await issueFraQueue(fra, fra.transaction_ref);
    fraService.markArrived(fra.transaction_ref).catch(() => {});
  }

  async function dispatchFraPickup(
    fra: FraRegistrationRow,
    pickupContracts: readonly FraRegistrationRow[],
  ): Promise<void> {
    // No kiosk_checkins dedup — fra_registrations.status='or_issued' is the gate.
    await issueFraPickupQueue(fra, fra.transaction_ref);
    fraService.markPickedUp(pickupContracts.map((c) => c.id)).catch(() => {});
  }

  async function dispatchFraDeferred(
    fra: FraRegistrationRow,
    deferredContracts: readonly FraRegistrationRow[],
  ): Promise<void> {
    const dup = await queueService.checkDuplicate(fra.transaction_ref);
    if (dup) throw new Error(`Already checked in as Q#${dup.displayNumber}.`);
    await issueFraQueue(fra, fra.transaction_ref, 'DEFERRED', '(Deferred)');
    fraService.clearStaffNotes(deferredContracts.map((c) => c.id)).catch(() => {});
  }

  /** Issue an A001 queue number for an FRA group, with optional remarks tag and ticket suffix. */
  async function issueFraQueue(
    fra: FraRegistrationRow,
    refCode: string,
    remarks?: string,
    serviceLabelSuffix?: string,
  ): Promise<void> {
    const assignment = await queueService.checkinAndAssignQueue({
      refCode,
      appointmentType: 'FRA',
      queueSeries: 'FRA',
      serviceType: 'FRA_REGISTRATION',
      clientName: fra.fra,
      transactionRef: fra.transaction_ref,
      remarks,
    });
    onCheckinComplete(assignment.displayNumber, fra.fra);
    const label = `FRA Registration${serviceLabelSuffix ? ` ${serviceLabelSuffix}` : ''}`;
    maybePrint(assignment.displayNumber, fra.fra, label);
  }

  /**
   * Issue a PICKUP ticket for an FRA group.
   * Stays on the FRA A-series (matches the fresh submission flow); the
   * `appointment_type='PICKUP'` column is the signal the receptionist console
   * uses to distinguish pickups from fresh submissions.
   */
  async function issueFraPickupQueue(
    fra: FraRegistrationRow,
    refCode: string,
  ): Promise<void> {
    const assignment = await queueService.checkinAndAssignQueue({
      refCode,
      appointmentType: 'PICKUP',
      queueSeries: 'FRA',
      serviceType: 'FRA_REGISTRATION',
      clientName: fra.fra,
      transactionRef: fra.transaction_ref,
    });
    onCheckinComplete(assignment.displayNumber, fra.fra);
    maybePrint(assignment.displayNumber, fra.fra, 'PICKUP - FRA');
  }

  // ─── Submission (Accreditation) dispatch ────────────────────────────────────

  async function checkinSubmission(submission: SubmissionRow): Promise<void> {
    if (submissionService.isBlocked(submission)) {
      throw new Error(
        `This accreditation submission is ${submission.status ?? 'closed'} and cannot be checked in.`,
      );
    }
    const isPickup = submissionService.isPickupEligible(submission);
    const isFirstVisit = !isPickup && submissionService.isFirstVisitEligible(submission);

    if (!isPickup && !isFirstVisit) {
      throw new Error(
        `This submission is in status "${submission.status ?? 'unknown'}" and cannot be checked in right now.`,
      );
    }

    const refCode = submission.ref_code;
    const name = submissionService.resolveSubmissionName(submission) || 'Accreditation Client';

    // Pickups skip the kiosk_checkins dedup — eligibility is driven entirely
    // by trans_status on the submissions row.
    if (!isPickup) {
      const dup = await queueService.checkDuplicate(refCode);
      if (dup) throw new Error(`Check-in already issued as Q#${dup.displayNumber}.`);
    }

    const assignment = await queueService.checkinAndAssignQueue({
      refCode,
      appointmentType: isPickup ? 'PICKUP' : 'APPOINTMENT',
      queueSeries: 'REGULAR',
      serviceType: 'ACCREDITATION',
      clientName: name,
      transactionRef: refCode,
    });

    onCheckinComplete(assignment.displayNumber, name);
    maybePrint(
      assignment.displayNumber,
      name,
      isPickup ? 'PICKUP - ACCREDITATION' : 'ACCREDITATION',
    );
  }

  // ─── Confirm callback for the FRA pickup/submit modal ─────────────────────────

  async function handleFraModalConfirm(choice: { pickup: boolean; submit: boolean }): Promise<void> {
    if (!pendingFra) return;
    const { fra, pickupContracts, deferredContracts } = pendingFra;
    setPendingFra(null);
    setChecking(true);
    setError('');

    try {
      if (choice.pickup) {
        await dispatchFraPickup(fra, pickupContracts);
      }
      if (choice.submit) {
        await dispatchFraDeferred(fra, deferredContracts);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setChecking(false);
    }
  }

  // ─── Main click handler ──────────────────────────────────────────────────────

  async function handleCheckin(forceWalkIn = false): Promise<void> {
    if (!selected) return;
    setChecking(true);
    setError('');

    try {
      if (selected.type === 'appointment') {
        await checkinAppointment(selected.data, forceWalkIn);
      } else if (selected.type === 'fra') {
        await checkinFra(selected.data);
      } else {
        await checkinSubmission(selected.data);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Check-in failed';
      const isNetworkError = raw.includes('Failed to fetch') || raw.includes('NetworkError');
      setError(isNetworkError ? 'Cannot connect to server. Please check network connection.' : raw);
    } finally {
      setChecking(false);
    }
  }

  async function handleReprint(): Promise<void> {
    if (!lastCheckin) return;
    try {
      await window.electronAPI.printTicket({
        queueNumber: lastCheckin.queueNumber,
        clientName: lastCheckin.name,
        serviceType: '',
      });
    } catch {
      // Silently fail on reprint
    }
  }

  // ─── Render: empty state ──────────────────────────────────────────────────
  if (!selected) {
    if (lastCheckin) {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-6">
          <QueueNumberDisplay number={lastCheckin.queueNumber} label="Last Check-In" />
          <p className="text-lg text-gray-600">{lastCheckin.name}</p>
          <button
            onClick={() => void handleReprint()}
            className="px-6 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Reprint Ticket
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 text-lg">Select an appointment to check in</p>
      </div>
    );
  }

  // ─── Render: submission detail ──────────────────────────────────────────────
  if (selected.type === 'submission') {
    const s = selected.data;
    const name = submissionService.resolveSubmissionName(s) || 'Accreditation client';
    const isBlocked = submissionService.isBlocked(s);
    const isPickup = submissionService.isPickupEligible(s);
    const isFirstVisit = !isPickup && submissionService.isFirstVisitEligible(s);

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-800">Accreditation Submission</h2>

        {isPickup && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <strong>Pickup:</strong> Submission is ready. Issuing pickup queue number.
          </div>
        )}
        {isFirstVisit && (
          <div className="text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-4 py-3">
            <strong>First visit:</strong> New accreditation submission. Issuing arrived queue number.
          </div>
        )}
        {isBlocked && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            This submission is <strong>{s.status}</strong> and cannot be checked in.
          </div>
        )}

        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400 uppercase">Agency / Client</p>
              <p className="text-lg font-semibold text-gray-800">{name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Ref Code</p>
              <p className="text-lg font-mono text-gray-800">{s.ref_code}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Status</p>
              <p className="text-gray-700">{s.status ?? 'pending'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Trans Status</p>
              <p className="text-gray-700">{s.trans_status ?? '—'}</p>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

        {!isBlocked && (isPickup || isFirstVisit) && (
          <button
            onClick={() => void handleCheckin()}
            disabled={checking}
            className={`w-full py-4 text-lg font-bold text-white rounded-xl disabled:opacity-50 transition-colors ${
              isPickup ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {checking
              ? 'Checking In...'
              : isPickup
                ? 'Check In (Pickup) & Print Ticket'
                : 'Check In & Print Ticket'}
          </button>
        )}
      </div>
    );
  }

  // ─── Render: appointment detail ────────────────────────────────────────────
  if (selected.type === 'appointment') {
    const a = selected.data;
    const today = todaySGT();
    const name = [a.ofw_fname, a.ofw_mname, a.ofw_lname].filter(Boolean).join(' ');
    const serviceLabel = a.services?.name ?? resolveServiceLabel(a.service_id);
    const status = (a.status ?? '').toLowerCase();

    const isNotToday = a.appointment_date !== today;
    const isFuture = isFutureDate(a.appointment_date);
    const isPast = a.appointment_date < today;
    const isDh = isDhAppointment(a.service_id);
    // Pickup only applies to DH appointments; CV does not have a pickup step.
    const isNewPickup = isDh && APPOINTMENT_PICKUP_STATUSES.includes(status);
    const isTerminal =
      ['cancelled', 'no_show', 'released'].includes(status) ||
      (status === 'completed' && !isNewPickup && !(isDh && a.appt_status === 'ARRIVED' && isPast));
    const isDhPickup = isPast && isDh && a.appt_status === 'ARRIVED';
    const isDhDeferred = isPast && isDh && a.appt_status === 'DEFERRED';
    const showPickupBanner = isNewPickup || isDhPickup;

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-800">Appointment Details</h2>

        {isFuture && (
          <div className="text-sm text-blue-700 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3">
            <strong>Future appointment:</strong> Scheduled for <strong>{a.appointment_date}</strong>.
            Review details and approve below to check in as walk-in.
          </div>
        )}

        {showPickupBanner && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <strong>Pickup:</strong> Client is returning for OR or documents. Issuing pickup queue number.
          </div>
        )}

        {isDhDeferred && (
          <div className="text-sm text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
            <strong>Deferred:</strong> Past DH appointment marked DEFERRED. Re-checking in will issue a new queue number.
          </div>
        )}

        {isNotToday && !isFuture && !showPickupBanner && !isDhDeferred && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            This appointment was for <strong>{a.appointment_date}</strong> (past date).
          </div>
        )}

        {isTerminal && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            This appointment is <strong>{a.status}</strong> and cannot be checked in.
          </div>
        )}

        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400 uppercase">Name</p>
              <p className="text-lg font-semibold text-gray-800">{name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Ref Code</p>
              <p className="text-lg font-mono text-gray-800">{a.ref_code}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Service</p>
              <p className="text-gray-700">{serviceLabel}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Status</p>
              <p className="text-gray-700">
                {a.status}{a.appt_status ? ` (${a.appt_status})` : ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Date / Time</p>
              <p className={`font-medium ${isFuture ? 'text-blue-600' : isNotToday ? 'text-amber-600' : 'text-gray-700'}`}>
                {a.appointment_date} {a.start_time}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Contact</p>
              <p className="text-gray-700">{a.client_contact ?? a.client_email}</p>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

        {/* Future: Approve & Check In as Walk-in */}
        {isFuture && !isTerminal && !isNewPickup && (
          <button
            onClick={() => void handleCheckin(true)}
            disabled={checking}
            className="w-full py-4 text-lg font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking In...' : 'Approve & Check In as Walk-in'}
          </button>
        )}

        {/* Today / past / pickup: normal check-in */}
        {!isFuture && !isTerminal && (
          <button
            onClick={() => void handleCheckin()}
            disabled={checking}
            className={`w-full py-4 text-lg font-bold text-white rounded-xl disabled:opacity-50 transition-colors ${
              showPickupBanner ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-teal-500 hover:bg-teal-600'
            }`}
          >
            {checking
              ? 'Checking In...'
              : showPickupBanner
                ? 'Check In (Pickup) & Print Ticket'
                : isDhDeferred
                  ? 'Check In (Deferred) & Print Ticket'
                  : 'Check In & Print Ticket'}
          </button>
        )}
      </div>
    );
  }

  // ─── Render: FRA detail ───────────────────────────────────────────────────
  const f = selected.data;
  const today = todaySGT();
  const isFraFuture = f.appointment_date > today;
  const isFraPast = f.appointment_date < today;
  const isFraTerminal = f.status === 'cancelled' || f.status === 'moved';

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">FRA Registration Details</h2>

      <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <strong>Batch check-in:</strong> All contracts under this transaction ref will be checked in together.
      </div>

      {isFraFuture && (
        <div className="text-sm text-blue-700 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3">
          <strong>Future appointment:</strong> Scheduled for <strong>{f.appointment_date}</strong>.
          Approve below to check in early.
        </div>
      )}

      {isFraPast && !isFraTerminal && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Past appointment. Pickup or deferred contracts will be detected automatically.
        </div>
      )}

      {f.status === 'moved' && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          This FRA group has been split. Please ask the client for their new printed QR.
        </div>
      )}

      {f.status === 'cancelled' && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          This FRA registration is <strong>cancelled</strong> and cannot be checked in.
        </div>
      )}

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase">Agency (FRA)</p>
            <p className="text-lg font-semibold text-gray-800">{f.fra}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Transaction Ref</p>
            <p className="text-lg font-mono text-gray-800">{f.transaction_ref.slice(0, 12)}...</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Personnel</p>
            <p className="text-gray-700">{f.agency_personnel}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">PRA</p>
            <p className="text-gray-700">{f.pra}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Status</p>
            <p className="text-gray-700">{f.status}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Appointment Date</p>
            <p className={`font-medium ${isFraFuture ? 'text-blue-600' : isFraPast ? 'text-amber-600' : 'text-gray-700'}`}>
              {f.appointment_date ?? 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

      {!isFraTerminal && (
        <button
          onClick={() => void handleCheckin()}
          disabled={checking}
          className={`w-full py-4 text-lg font-bold text-white rounded-xl disabled:opacity-50 transition-colors ${
            isFraFuture ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          {checking
            ? 'Checking In...'
            : isFraFuture
              ? 'Approve & Check In'
              : 'Batch Check In & Print Ticket'}
        </button>
      )}

      {/* Mixed pickup/deferred modal */}
      <FraPickupSubmitModal
        open={pendingFra !== null}
        fraName={pendingFra?.fra.fra ?? ''}
        pickupCount={pendingFra?.pickupContracts.length ?? 0}
        deferredCount={pendingFra?.deferredContracts.length ?? 0}
        onConfirm={(choice) => void handleFraModalConfirm(choice)}
        onCancel={() => setPendingFra(null)}
      />
    </div>
  );
}
