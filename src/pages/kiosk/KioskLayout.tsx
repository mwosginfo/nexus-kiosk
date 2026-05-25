import { useState, useCallback } from 'react';
import { SplashScreen } from './SplashScreen';
import { EntryScreen } from './EntryScreen';
import { SuccessScreen } from './SuccessScreen';
import { ErrorScreen } from './ErrorScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useScanner } from '../../hooks/useScanner';
import { detectScanType, resolveServiceLabel, todaySGT, daysAgoSGT } from '../../lib/constants';
import { isFraCheckinOpen, FRA_CUTOFF_MESSAGE } from '../../lib/business-hours';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as queueService from '../../services/queue.service';
import * as pickupService from '../../services/pickup.service';
import * as submissionService from '../../services/submission.service';

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
    async (pickup: pickupService.OfwPickup, refCode: string) => {
      const dup = await queueService.checkDuplicateForPickup(refCode);
      if (dup) {
        setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
        setScreen('ERROR');
        return;
      }

      if (pickup.kind === 'APPOINTMENT') {
        const serviceInfo = await appointmentService.lookupServiceInfo(
          pickup.appointment.service_id,
        );
        const assignment = await queueService.checkinAndAssignQueue({
          refCode: pickup.appointment.ref_code,
          appointmentType: 'APPOINTMENT',
          queueSeries: serviceInfo.series,
          serviceType: serviceInfo.serviceType,
          clientName: pickup.clientName,
          clientEmail: pickup.appointment.client_email,
          appointmentId: pickup.appointment.id,
          transactionRef: pickup.appointment.ref_code,
          remarks: 'PICKUP',
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
        appointmentType: 'APPOINTMENT',
        queueSeries: 'REGULAR',
        serviceType: 'ACCREDITATION',
        clientName: pickup.clientName,
        transactionRef: pickup.submission.ref_code,
        remarks: 'PICKUP',
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
      const dup = await queueService.checkDuplicateForPickup(pickup.fra.transaction_ref);
      if (dup) {
        setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
        setScreen('ERROR');
        return;
      }
      // Pickup uses the regular 6000 series, not the FRA A-series
      const assignment = await queueService.checkinAndAssignQueue({
        refCode: pickup.fra.transaction_ref,
        appointmentType: 'APPOINTMENT',
        queueSeries: 'REGULAR',
        serviceType: 'FRA_REGISTRATION',
        clientName: pickup.clientName,
        transactionRef: pickup.fra.transaction_ref,
        remarks: 'PICKUP',
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

  const doCheckin = useCallback(
    async (value: string) => {
      // Single-input kiosk: route by the shape of the scanned/keyed code.
      // FRA refs are UUIDs / long alphanumerics; appointment + accreditation
      // refs flow through the OFW ladder (appointment lookup → submission).
      const isFra = detectScanType(value) === 'FRA';

      if (isFra && !isFraCheckinOpen()) {
        setErrorMsg(FRA_CUTOFF_MESSAGE);
        setScreen('ERROR');
        return;
      }

      setLoading(true);
      try {
        if (isFra) {
          // Look up regardless of date: pickup/deferred returnees may carry a QR
          // older than the fresh-check-in window ("release day onwards"). The
          // date window is re-applied only on the fresh-check-in branch below.
          const fra = await fraService.lookupByRef(value, { strict: false });
          if (!fra) {
            setErrorMsg('No FRA registration found for this code.');
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

          // Analyze the whole transaction_ref group so a returning client with
          // partially-processed contracts (some completed, some deferred) is routed
          // correctly. The single lookup row alone cannot represent a mixed group,
          // which previously caused a returning deferred client to be mis-routed
          // into a pickup ticket and never queued for submission.
          const contracts = await fraService.getGroupContracts(fra.transaction_ref);
          const analysis = fraService.analyzeFraGroup(contracts);

          const dup = await queueService.checkDuplicate(fra.transaction_ref);
          if (dup) {
            setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
            setScreen('ERROR');
            return;
          }

          // Self-service prioritizes unfinished submission over pickup: a returning
          // client whose contracts were deferred is here to submit them. Mirrors the
          // receptionist deferred path (clears staff_notes, FRA A-series, DEFERRED tag)
          // but without the staff pickup/submit modal. Gateless — a deferred returnee
          // may come back after the fresh window has closed.
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

          // Pickup (status='or_issued') — gateless, release day onwards.
          if (analysis.pickupContracts.length > 0) {
            await dispatchFraPickup({ kind: 'FRA', fra, clientName: fra.fra });
            return;
          }

          // Fresh check-in — re-apply the date window (today through 14 days back,
          // no future) that the strict lookup used to enforce.
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
          return;
        }

        // OFW / Employer / Accreditation flow.
        const appt = await appointmentService.lookupByRefCode(value);

        const pickup = await pickupService.evaluateOfwPickup(value, appt);
        if (pickup) {
          await dispatchOfwPickup(pickup, value);
          return;
        }

        if (!appt) {
          // No appointment row — fall back to accreditation first-visit path.
          const submission = await submissionService.lookupByRefCode(value);
          if (submission && submissionService.isBlocked(submission)) {
            setErrorMsg('This accreditation submission cannot be checked in.');
            setScreen('ERROR');
            return;
          }
          if (submission && submissionService.isFirstVisitEligible(submission)) {
            await dispatchSubmissionFirstVisit(submission);
            return;
          }

          setErrorMsg('No appointment or accreditation submission found for this code.');
          setScreen('ERROR');
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
    [completeCheckin, dispatchFraPickup, dispatchOfwPickup, dispatchSubmissionFirstVisit],
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
