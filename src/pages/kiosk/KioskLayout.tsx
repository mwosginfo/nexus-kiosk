import { useState, useCallback } from 'react';
import { SplashScreen } from './SplashScreen';
import { TypeSelectScreen } from './TypeSelectScreen';
import { SearchMethodScreen } from './SearchMethodScreen';
import { ManualSearchScreen } from './ManualSearchScreen';
import { SuccessScreen } from './SuccessScreen';
import { ErrorScreen } from './ErrorScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useScanner } from '../../hooks/useScanner';
import { UUID_REGEX } from '../../lib/constants';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as checkinBridge from '../../services/checkin-bridge.service';

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

  // Auto-return to splash after 60s idle (except on splash itself)
  useIdleTimer(
    60_000,
    () => setScreen('SPLASH'),
    screen !== 'SPLASH'
  );

  // Perform the full checkin flow
  const doCheckin = useCallback(async (value: string, type: AppointmentType) => {
    setLoading(true);
    try {
      if (type === 'fra') {
        // FRA flow
        const fra = await fraService.lookupByRef(value);
        if (!fra) {
          setScreen('ERROR');
          return;
        }

        if (fra.status !== 'arrived') {
          await fraService.markArrived(fra.id);
        }

        // Request queue number via bridge (Nexus picks up from kiosk_checkins)
        const bridgeResult = await checkinBridge.requestCheckin(fra.transaction_ref, 'FRA');

        const checkinResult: CheckinResult = {
          queueNumber: bridgeResult.displayNumber,
          name: fra.fra,
          serviceType: 'FRA REGISTRATION',
        };

        await window.electronAPI.printTicket({
          queueNumber: checkinResult.queueNumber,
          clientName: checkinResult.name,
          serviceType: checkinResult.serviceType,
        });

        setResult(checkinResult);
        setScreen('SUCCESS');
      } else {
        // Regular appointment flow
        const appt = await appointmentService.lookupByRefCode(value);
        if (!appt) {
          setScreen('ERROR');
          return;
        }

        if (appt.appt_status !== 'ARRIVED') {
          await appointmentService.markArrived(appt.id);
        }

        // Request queue number via bridge
        const bridgeResult = await checkinBridge.requestCheckin(appt.ref_code, 'APPOINTMENT');

        const name = [appt.client_fname, appt.client_mname, appt.client_lname]
          .filter(Boolean)
          .join(' ');

        const checkinResult: CheckinResult = {
          queueNumber: bridgeResult.displayNumber,
          name,
          serviceType: bridgeResult.serviceType.replace(/_/g, ' '),
        };

        await window.electronAPI.printTicket({
          queueNumber: checkinResult.queueNumber,
          clientName: checkinResult.name,
          serviceType: checkinResult.serviceType,
        });

        setResult(checkinResult);
        setScreen('SUCCESS');
      }
    } catch (err) {
      console.error('[KioskLayout] Checkin error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Check-in failed');
      setScreen('ERROR');
    } finally {
      setLoading(false);
    }
  }, []);

  // Phone lookup — regular appointments only (FRA uses transaction_ref only)
  const doPhoneCheckin = useCallback(async (phone: string) => {
    setLoading(true);
    try {
      const results = await appointmentService.lookupByPhone(phone);
      if (results.length === 0) {
        setScreen('ERROR');
        return;
      }
      await doCheckin(results[0]!.ref_code, 'regular');
    } catch (err) {
      console.error('[KioskLayout] Phone checkin error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Search failed');
      setScreen('ERROR');
    } finally {
      setLoading(false);
    }
  }, [doCheckin]);

  // Global QR scanner — always active except on splash
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

  // ─── Render screens ──────────────────────────────────────────────────────

  switch (screen) {
    case 'SPLASH':
      return <SplashScreen onStart={() => setScreen('TYPE_SELECT')} />;

    case 'TYPE_SELECT':
      return (
        <TypeSelectScreen
          onSelect={(type) => {
            setAppointmentType(type);
            setScreen('SEARCH_METHOD');
          }}
        />
      );

    case 'SEARCH_METHOD':
      return (
        <SearchMethodScreen
          appointmentType={appointmentType}
          onSelectMethod={(method) => {
            setSearchMode(method);
            setScreen('MANUAL_SEARCH');
          }}
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
      return (
        <SuccessScreen
          result={result}
          onDone={() => setScreen('SPLASH')}
        />
      );

    case 'ERROR':
      return (
        <ErrorScreen
          message={errorMsg}
          onRetry={() => { setErrorMsg(''); setScreen('TYPE_SELECT'); }}
        />
      );
  }
}
