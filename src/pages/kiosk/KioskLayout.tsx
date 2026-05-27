import { useState, useCallback } from 'react';
import { SplashScreen } from './SplashScreen';
import { EntryScreen } from './EntryScreen';
import { SuccessScreen } from './SuccessScreen';
import { ErrorScreen } from './ErrorScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useScanner } from '../../hooks/useScanner';
import { resolveServiceLabel, todaySGT, daysAgoSGT } from '../../lib/constants';
import { isFraCheckinOpen, FRA_CUTOFF_MESSAGE } from '../../lib/business-hours';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as queueService from '../../services/queue.service';
import * as pickupService from '../../services/pickup.service';
import * as submissionService from '../../services/submission.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';

type KioskScreen = 'SPLASH' | 'ENTRY' | 'SUCCESS' | 'ERROR';

interface CheckinResult {
  readonly queueNumber: string;
  readonly name: string;
  readonly serviceType: string;
}

export function KioskLayout() {
  const [screen, setScreen] = useState<KioskScreen>('SPLASH');
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useIdleTimer(60_000, () => setScreen('SPLASH'), screen !== 'SPLASH');

  const completeCheckin = useCallback((checkinResult: CheckinResult) => {
    setResult(checkinResult);
    setScreen('SUCCESS');
    window.electronAPI
      .printTicket({
        queueNumber: checkinResult.queueNumber,
        clientName: checkinResult.name,
        serviceType: checkinResult.serviceType,
      })
      .catch((err: unknown) => console.error('[KioskLayout] Print error:', err));
  }, []);

  const dispatchOfwPickup = useCallback(
    async (pickup: pickupService.OfwPickup, _refCode: string) => {
      // No kiosk_checkins dedup for pickups — eligibility is driven by the
      // source-table status. A returning client may rescan freely; if the OR
      // has already been released the source row will no longer be in a
      // pickup-eligible state and the unified router will not reach this branch.
      if (pickup.kind === 'APPOINTMENT') {
        const serviceInfo = await appointmentService.lookupServiceInfo(
          pickup.appointment.service_id,
        );
        const assignment = await queueService.checkinAndAssignQueue({
          refCode: pickup.appointment.ref_code,
          appointmentType: 'PICKUP',
          queueSeries: serviceInfo.series,
          serviceType: serviceInfo.serviceType,
          clientName: pickup.clientName,
          clientEmail: pickup.appointment.client_email,
          appointmentId: pickup.appointment.id,
          transactionRef: pickup.appointment.ref_code,
        });
        completeCheckin({
          queueNumber: assignment.displayNumber,
          name: pickup.clientName,
          serviceType: pickupService.pickupTicketLabel(pickup),
        });
        return;
      }

      // ACCREDITATION
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: pickup.submission.ref_code,
        appointmentType: 'PICKUP',
        queueSeries: 'REGULAR',
        serviceType: 'ACCREDITATION',
        clientName: pickup.clientName,
        transactionRef: pickup.submission.ref_code,
      });
      completeCheckin({
        queueNumber: assignment.displayNumber,
        name: pickup.clientName,
        serviceType: pickupService.pickupTicketLabel(pickup),
      });
    },
    [completeCheckin],
  );

  const dispatchFraPickup = useCallback(
    async (pickup: pickupService.FraPickup) => {
      // FRA pickup stays on the FRA A-series (same as the fresh submission flow).
      // appointment_type='PICKUP' is the signal the receptionist console reads;
      // queue_series='FRA' keeps the agency clients in their own number range.
      // No kiosk_checkins dedup — fra_registrations.status='or_issued' is the
      // gate. Once the OR is received the status moves on and the unified
      // router will not classify subsequent scans as pickup.
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: pickup.fra.transaction_ref,
        appointmentType: 'PICKUP',
        queueSeries: 'FRA',
        serviceType: 'FRA_REGISTRATION',
        clientName: pickup.clientName,
        transactionRef: pickup.fra.transaction_ref,
      });
      completeCheckin({
        queueNumber: assignment.displayNumber,
        name: pickup.clientName,
        serviceType: pickupService.pickupTicketLabel(pickup),
      });
    },
    [completeCheckin],
  );

  const dispatchSubmissionFirstVisit = useCallback(
    async (submission: pickupService.AccreditationPickup['submission']) => {
      const dup = await queueService.checkDuplicate(submission.ref_code);
      if (dup) {
        setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
        setScreen('ERROR');
        return;
      }
      const name = submissionService.resolveSubmissionName(submission);
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: submission.ref_code,
        appointmentType: 'APPOINTMENT',
        queueSeries: 'REGULAR',
        serviceType: 'ACCREDITATION',
        clientName: name || 'Accreditation Client',
        transactionRef: submission.ref_code,
      });
      completeCheckin({
        queueNumber: assignment.displayNumber,
        name: name || 'Accreditation Client',
        serviceType: 'Accreditation',
      });
    },
    [completeCheckin],
  );

  const handleFra = useCallback(
    async (fra: FraRegistrationRow, value: string) => {
      // Cutoff is enforced AFTER the row resolves so a legitimate appointment
      // scanned after 12pm never sees the FRA cutoff message.
      if (!isFraCheckinOpen()) {
        setErrorMsg(FRA_CUTOFF_MESSAGE);
        setScreen('ERROR');
        return;
      }
      if (fra.status === 'cancelled') {
        setErrorMsg('This FRA registration is cancelled and cannot be checked in.');
        setScreen('ERROR');
        return;
      }
      if (fra.status === 'moved') {
        setErrorMsg('This FRA group has been split. Please use the new printed QR.');
        setScreen('ERROR');
        return;
      }

      const contracts = await fraService.getGroupContracts(fra.transaction_ref);
      const analysis = fraService.analyzeFraGroup(contracts);

      const dup = await queueService.checkDuplicate(fra.transaction_ref);
      if (dup) {
        setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
        setScreen('ERROR');
        return;
      }

      if (analysis.deferredContracts.length > 0) {
        const assignment = await queueService.checkinAndAssignQueue({
          refCode: fra.transaction_ref,
          appointmentType: 'FRA',
          queueSeries: 'FRA',
          serviceType: 'FRA_REGISTRATION',
          clientName: fra.fra,
          transactionRef: fra.transaction_ref,
          remarks: 'DEFERRED',
        });
        fraService
          .clearStaffNotes(analysis.deferredContracts.map((c) => c.id))
          .catch(() => {});
        completeCheckin({
          queueNumber: assignment.displayNumber,
          name: fra.fra,
          serviceType: 'FRA Registration',
        });
        return;
      }

      if (analysis.pickupContracts.length > 0) {
        await dispatchFraPickup({ kind: 'FRA', fra, clientName: fra.fra });
        return;
      }

      // Fresh check-in — re-apply the today-through-14-days-back window.
      if (fra.appointment_date > todaySGT()) {
        setErrorMsg(`Registration is for ${fra.appointment_date}. Please come on your scheduled day.`);
        setScreen('ERROR');
        return;
      }
      if (fra.appointment_date < daysAgoSGT(14)) {
        setErrorMsg('This FRA registration is older than 14 days. Please see the receptionist.');
        setScreen('ERROR');
        return;
      }

      const assignment = await queueService.checkinAndAssignQueue({
        refCode: value,
        appointmentType: 'FRA',
        queueSeries: 'FRA',
        serviceType: 'FRA_REGISTRATION',
        clientName: fra.fra,
        transactionRef: fra.transaction_ref,
      });
      fraService.markArrived(fra.transaction_ref).catch(() => {});
      completeCheckin({
        queueNumber: assignment.displayNumber,
        name: fra.fra,
        serviceType: 'FRA Registration',
      });
    },
    [completeCheckin, dispatchFraPickup],
  );

  const handleAppointment = useCallback(
    async (appt: AppointmentWithService, value: string) => {
      // Pickup check first (re-uses the pre-fetched appointment row).
      const pickup = await pickupService.evaluateOfwPickup(value, appt);
      if (pickup) {
        await dispatchOfwPickup(pickup, value);
        return;
      }

      const validation = appointmentService.validateAppointment(appt);
      if (!validation.ok) {
        setErrorMsg(validation.message);
        setScreen('ERROR');
        return;
      }

      const dup = await queueService.checkDuplicate(appt.ref_code);
      if (dup) {
        setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
        setScreen('ERROR');
        return;
      }

      const serviceInfo = await appointmentService.lookupServiceInfo(appt.service_id);
      const clientName = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
        .filter(Boolean)
        .join(' ');

      const assignment = await queueService.checkinAndAssignQueue({
        refCode: appt.ref_code,
        appointmentType: 'APPOINTMENT',
        queueSeries: serviceInfo.series,
        serviceType: serviceInfo.serviceType,
        clientName,
        clientEmail: appt.client_email,
        appointmentId: appt.id,
        transactionRef: appt.ref_code,
      });

      const arrivalUpdate =
        appt.appt_status === 'DEFERRED'
          ? appointmentService.markArrivedFromDeferred(appt.id)
          : appointmentService.markArrived(appt.id);
      arrivalUpdate.catch(() => {});

      completeCheckin({
        queueNumber: assignment.displayNumber,
        name: clientName,
        serviceType: resolveServiceLabel(appt.service_id),
      });
    },
    [completeCheckin, dispatchOfwPickup],
  );

  const handleSubmission = useCallback(
    async (submission: pickupService.AccreditationPickup['submission']) => {
      if (submissionService.isBlocked(submission)) {
        setErrorMsg('This accreditation submission cannot be checked in.');
        setScreen('ERROR');
        return;
      }
      if (submissionService.isPickupEligible(submission)) {
        await dispatchOfwPickup(
          {
            kind: 'ACCREDITATION',
            submission,
            clientName: submissionService.resolveSubmissionName(submission),
          },
          submission.ref_code,
        );
        return;
      }
      if (submissionService.isFirstVisitEligible(submission)) {
        await dispatchSubmissionFirstVisit(submission);
        return;
      }
      setErrorMsg('This accreditation submission cannot be checked in.');
      setScreen('ERROR');
    },
    [dispatchOfwPickup, dispatchSubmissionFirstVisit],
  );

  const doCheckin = useCallback(
    async (value: string) => {
      setLoading(true);
      try {
        // Unified router: probe all three sources in parallel. Whichever has a
        // row wins; ambiguity (2+ matches) is rejected to the receptionist.
        // Pass {strict:false} to FRA so pickup/deferred returnees with QRs older
        // than the fresh window still resolve.
        const [appt, fra, submission] = await Promise.all([
          appointmentService.lookupByRefCode(value),
          fraService.lookupByRef(value, { strict: false }),
          submissionService.lookupByRefCode(value),
        ]);

        const matchCount = (appt ? 1 : 0) + (fra ? 1 : 0) + (submission ? 1 : 0);

        if (matchCount === 0) {
          setErrorMsg(
            'No appointment, FRA registration, or accreditation submission found for this code.',
          );
          setScreen('ERROR');
          return;
        }

        if (matchCount > 1) {
          setErrorMsg('Ambiguous reference — please see the receptionist.');
          setScreen('ERROR');
          return;
        }

        if (fra) {
          await handleFra(fra, value);
          return;
        }
        if (appt) {
          await handleAppointment(appt, value);
          return;
        }
        if (submission) {
          await handleSubmission(submission);
          return;
        }
      } catch (err) {
        console.error('[KioskLayout] Checkin error:', err);
        const raw = err instanceof Error ? err.message : 'Check-in failed. Please try again.';
        const isNetworkError =
          raw.includes('Failed to fetch') ||
          raw.includes('NetworkError') ||
          raw.includes('ERR_NAME');
        setErrorMsg(
          isNetworkError ? 'Cannot connect to server. Please check network connection.' : raw,
        );
        setScreen('ERROR');
      } finally {
        setLoading(false);
      }
    },
    [handleFra, handleAppointment, handleSubmission],
  );

  useScanner({
    onScan: (scanned) => {
      // doCheckin auto-detects FRA vs appointment/accreditation from the code.
      void doCheckin(scanned);
    },
    enabled: screen === 'ENTRY',
  });

  switch (screen) {
    case 'SPLASH':
      return <SplashScreen onStart={() => setScreen('ENTRY')} />;
    case 'ENTRY':
      return (
        <EntryScreen
          loading={loading}
          onSubmit={(refCode) => void doCheckin(refCode)}
          onBack={() => setScreen('SPLASH')}
        />
      );
    case 'SUCCESS':
      return <SuccessScreen result={result} onDone={() => setScreen('SPLASH')} />;
    case 'ERROR':
      return (
        <ErrorScreen
          message={errorMsg}
          onRetry={() => {
            setErrorMsg('');
            setScreen('ENTRY');
          }}
        />
      );
  }
}
