import { useState, useCallback } from 'react';
import { SplashScreen } from './SplashScreen';
import { TypeSelectScreen } from './TypeSelectScreen';
import { SearchMethodScreen } from './SearchMethodScreen';
import { ManualSearchScreen } from './ManualSearchScreen';
import { SuccessScreen } from './SuccessScreen';
import { ErrorScreen } from './ErrorScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useScanner } from '../../hooks/useScanner';
import { UUID_REGEX, resolveServiceLabel } from '../../lib/constants';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as queueService from '../../services/queue.service';

type KioskScreen =
  | 'SPLASH'
  | 'TYPE_SELECT'
  | 'SEARCH_METHOD'
  | 'MANUAL_SEARCH'
  | 'SUCCESS'
  | 'ERROR';

type AppointmentType = 'regular' | 'fra';
type SearchMode = 'phone' | 'ref_code';

interface CheckinResult {
  readonly queueNumber: string;
  readonly name: string;
  readonly serviceType: string;
}

export function KioskLayout() {
  const [screen, setScreen] = useState<KioskScreen>('SPLASH');
  const [appointmentType, setAppointmentType] = useState<AppointmentType>('regular');
  const [searchMode, setSearchMode] = useState<SearchMode>('ref_code');
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useIdleTimer(60_000, () => setScreen('SPLASH'), screen !== 'SPLASH');

  const doCheckin = useCallback(async (value: string, type: AppointmentType) => {
    setLoading(true);
    try {
      if (type === 'fra') {
        // ─── FRA flow ────────────────────────────────────────────────
        const fra = await fraService.lookupByRef(value);
        if (!fra) {
          setErrorMsg('No FRA registration found for today.');
          setScreen('ERROR');
          return;
        }

        if (fra.status === 'completed' || fra.status === 'cancelled') {
          setErrorMsg(`This FRA registration is ${fra.status} and cannot be checked in.`);
          setScreen('ERROR');
          return;
        }

        // Check duplicate
        const dup = await queueService.checkDuplicate(value);
        if (dup) {
          setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
          setScreen('ERROR');
          return;
        }

        // Get queue number + insert kiosk_checkins
        const assignment = await queueService.checkinAndAssignQueue({
          refCode: value,
          appointmentType: 'FRA',
          queueSeries: 'FRA',
          serviceType: 'FRA_REGISTRATION',
          clientName: fra.fra,
          transactionRef: fra.transaction_ref,
        });

        // Mark FRA as arrived (fire-and-forget)
        fraService.markArrived(fra.id).catch(() => {});

        const checkinResult: CheckinResult = {
          queueNumber: assignment.displayNumber,
          name: fra.fra,
          serviceType: 'FRA Registration',
        };

        setResult(checkinResult);
        setScreen('SUCCESS');

        window.electronAPI.printTicket({
          queueNumber: checkinResult.queueNumber,
          clientName: checkinResult.name,
          serviceType: checkinResult.serviceType,
        }).catch((err: unknown) => console.error('[KioskLayout] Print error:', err));
      } else {
        // ─── Regular appointment flow ────────────────────────────────
        const appt = await appointmentService.lookupByRefCode(value);
        if (!appt) {
          setErrorMsg('No appointment found for this QR code.');
          setScreen('ERROR');
          return;
        }

        // Validate status + date
        const validation = appointmentService.validateAppointment(appt);
        if (!validation.ok) {
          setErrorMsg(validation.message);
          setScreen('ERROR');
          return;
        }

        // Check duplicate
        const dup = await queueService.checkDuplicate(appt.ref_code);
        if (dup) {
          setErrorMsg(`Already checked in as Q#${dup.displayNumber}.`);
          setScreen('ERROR');
          return;
        }

        // Look up service info (slug → series + serviceType)
        const serviceInfo = await appointmentService.lookupServiceInfo(appt.service_id);

        const clientName = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
          .filter(Boolean)
          .join(' ');

        // Get queue number + insert kiosk_checkins
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

        const serviceLabel = resolveServiceLabel(appt.service_id);

        const checkinResult: CheckinResult = {
          queueNumber: assignment.displayNumber,
          name: clientName,
          serviceType: serviceLabel,
        };

        setResult(checkinResult);
        setScreen('SUCCESS');

        window.electronAPI.printTicket({
          queueNumber: checkinResult.queueNumber,
          clientName: checkinResult.name,
          serviceType: checkinResult.serviceType,
        }).catch((err: unknown) => console.error('[KioskLayout] Print error:', err));
      }
    } catch (err) {
      console.error('[KioskLayout] Checkin error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
      setScreen('ERROR');
    } finally {
      setLoading(false);
    }
  }, []);

  const doPhoneCheckin = useCallback(async (phone: string) => {
    setLoading(true);
    try {
      const results = await appointmentService.lookupByPhone(phone);
      if (results.length === 0) {
        setErrorMsg('No appointment found for this phone number.');
        setScreen('ERROR');
        return;
      }
      await doCheckin(results[0]!.ref_code, 'regular');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed');
      setScreen('ERROR');
    } finally {
      setLoading(false);
    }
  }, [doCheckin]);

  useScanner({
    onScan: (scanned) => {
      if (screen === 'SPLASH') return;
      const type = UUID_REGEX.test(scanned) ? 'fra' : appointmentType;
      void doCheckin(scanned, type);
    },
    enabled: screen !== 'SPLASH' && screen !== 'SUCCESS' && screen !== 'ERROR',
  });

  function handleSearch(value: string) {
    if (searchMode === 'phone') {
      void doPhoneCheckin(value);
    } else {
      void doCheckin(value, appointmentType);
    }
  }

  switch (screen) {
    case 'SPLASH':
      return <SplashScreen onStart={() => setScreen('TYPE_SELECT')} />;
    case 'TYPE_SELECT':
      return (
        <TypeSelectScreen
          onSelect={(type) => { setAppointmentType(type); setScreen('SEARCH_METHOD'); }}
        />
      );
    case 'SEARCH_METHOD':
      return (
        <SearchMethodScreen
          appointmentType={appointmentType}
          onSelectMethod={(method) => { setSearchMode(method); setScreen('MANUAL_SEARCH'); }}
          onBack={() => setScreen('TYPE_SELECT')}
        />
      );
    case 'MANUAL_SEARCH':
      return (
        <ManualSearchScreen
          searchMode={searchMode}
          loading={loading}
          onSearch={handleSearch}
          onBack={() => setScreen('SEARCH_METHOD')}
        />
      );
    case 'SUCCESS':
      return <SuccessScreen result={result} onDone={() => setScreen('SPLASH')} />;
    case 'ERROR':
      return (
        <ErrorScreen
          message={errorMsg}
          onRetry={() => { setErrorMsg(''); setScreen('TYPE_SELECT'); }}
        />
      );
  }
}
