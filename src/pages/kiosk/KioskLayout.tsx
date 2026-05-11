import { useState, useCallback } from 'react';
import { SplashScreen } from './SplashScreen';
import { TypeSelectScreen } from './TypeSelectScreen';
import { EntryScreen } from './EntryScreen';
import { SuccessScreen } from './SuccessScreen';
import { ErrorScreen } from './ErrorScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useScanner } from '../../hooks/useScanner';
import { detectScanType, resolveServiceLabel } from '../../lib/constants';
import { isFraCheckinOpen, FRA_CUTOFF_MESSAGE } from '../../lib/business-hours';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as queueService from '../../services/queue.service';
import * as pickupService from '../../services/pickup.service';

type KioskScreen = 'SPLASH' | 'TYPE_SELECT' | 'ENTRY' | 'SUCCESS' | 'ERROR';

type AppointmentType = 'regular' | 'fra';

interface CheckinResult {
  readonly queueNumber: string;
  readonly name: string;
  readonly serviceType: string;
}

export function KioskLayout() {
  const [screen, setScreen] = useState<KioskScreen>('SPLASH');
  const [appointmentType, setAppointmentType] = useState<AppointmentType>('regular');
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
      const dup = await queueService.checkDuplicate(refCode);
      if (dup) {
        setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
        setScreen('ERROR');
        return;
      }

      if (pickup.kind === 'DH') {
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
          serviceType: pickupService.pickupTicketLabel('DH'),
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
        serviceType: pickupService.pickupTicketLabel('ACCREDITATION'),
      });
    },
    [completeCheckin],
  );

  const dispatchFraPickup = useCallback(
    async (pickup: pickupService.FraPickup) => {
      const dup = await queueService.checkDuplicate(pickup.fra.transaction_ref);
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
        serviceType: pickupService.pickupTicketLabel('FRA'),
      });
    },
    [completeCheckin],
  );

  const doCheckin = useCallback(
    async (value: string, type: AppointmentType) => {
      if (type === 'fra' && !isFraCheckinOpen()) {
        setErrorMsg(FRA_CUTOFF_MESSAGE);
        setScreen('ERROR');
        return;
      }

      setLoading(true);
      try {
        if (type === 'fra') {
          const fra = await fraService.lookupByRef(value);
          if (!fra) {
            setErrorMsg('No FRA registration found within the last 14 days.');
            setScreen('ERROR');
            return;
          }
          if (fra.status === 'cancelled') {
            setErrorMsg('This FRA registration is cancelled and cannot be checked in.');
            setScreen('ERROR');
            return;
          }

          const fraPickup = pickupService.evaluateFraPickup(fra);
          if (fraPickup) {
            await dispatchFraPickup(fraPickup);
            return;
          }

          const dup = await queueService.checkDuplicate(value);
          if (dup) {
            setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
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

        // OFW / Employer flow — appointments first, accreditation pickup as fallback
        const appt = await appointmentService.lookupByRefCode(value);

        const pickup = await pickupService.evaluateOfwPickup(value, appt);
        if (pickup) {
          await dispatchOfwPickup(pickup, value);
          return;
        }

        if (!appt) {
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
    [completeCheckin, dispatchFraPickup, dispatchOfwPickup],
  );

  useScanner({
    onScan: (scanned) => {
      if (screen === 'SPLASH') return;
      const scanType = detectScanType(scanned);
      const type: AppointmentType = scanType === 'FRA' ? 'fra' : appointmentType;
      void doCheckin(scanned, type);
    },
    enabled: screen === 'TYPE_SELECT' || screen === 'ENTRY',
  });

  switch (screen) {
    case 'SPLASH':
      return <SplashScreen onStart={() => setScreen('TYPE_SELECT')} />;
    case 'TYPE_SELECT':
      return (
        <TypeSelectScreen
          onSelect={(type) => {
            setAppointmentType(type);
            setScreen('ENTRY');
          }}
        />
      );
    case 'ENTRY':
      return (
        <EntryScreen
          appointmentType={appointmentType}
          loading={loading}
          onSubmit={(refCode) => void doCheckin(refCode, appointmentType)}
          onBack={() => setScreen('TYPE_SELECT')}
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
            setScreen('TYPE_SELECT');
          }}
        />
      );
  }
}
