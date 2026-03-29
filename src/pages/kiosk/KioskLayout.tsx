import { useState, useCallback } from 'react';
import { SplashScreen } from './SplashScreen';
import { TypeSelectScreen } from './TypeSelectScreen';
import { SearchMethodScreen } from './SearchMethodScreen';
import { ManualSearchScreen } from './ManualSearchScreen';
import { SuccessScreen } from './SuccessScreen';
import { ErrorScreen } from './ErrorScreen';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useScanner } from '../../hooks/useScanner';
import { UUID_REGEX, SERVICE_LABELS } from '../../lib/constants';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as checkinBridge from '../../services/checkin-bridge.service';
import * as nexusApi from '../../services/nexus-api.client';

/** Resolve a human-readable service label from service_id or bridge serviceType */
function resolveServiceLabel(serviceId: string, bridgeServiceType?: string): string {
  // Try matching service_id against known labels
  for (const [key, id] of Object.entries(
    // Import would be circular — inline the ID map
    {
      SKILLED_CV: '30c55940-083c-434a-8212-e810f2fa37b2',
      MDW_CV: 'cc50f069-1dc6-48ac-9e04-dbaf2a28b839',
      OWWA: '23470e2d-397e-4a24-b3ee-f55ed3fec65c',
      DH: 'ff4eeaf1-0009-4664-b9d8-6ea48de0f745',
      FRA_REGISTRATION: '7b9257b9-b2b6-404c-b277-c585ef27ec34',
    } as Record<string, string>,
  )) {
    if (id === serviceId) return SERVICE_LABELS[key] ?? key.replace(/_/g, ' ');
  }
  // Fallback to bridge value if it's not a UUID
  if (bridgeServiceType && !/^[0-9a-f-]{36}$/i.test(bridgeServiceType)) {
    return bridgeServiceType.replace(/_/g, ' ');
  }
  return 'Contract Verification';
}

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

  // Perform the full checkin flow — tries direct Nexus API first, falls back to Supabase bridge
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

        let displayNumber: string;

        // Try direct API first (LAN), fall back to bridge (external)
        if (nexusApi.isAuthenticated()) {
          try {
            const apiResult = await nexusApi.fraCheckin(fra.transaction_ref);
            displayNumber = apiResult.displayNumber;
          } catch (apiErr) {
            console.warn('[KioskLayout] Direct API failed, trying bridge:', apiErr);
            const bridgeResult = await checkinBridge.requestCheckin(fra.transaction_ref, 'FRA');
            displayNumber = bridgeResult.displayNumber;
          }
        } else {
          const bridgeResult = await checkinBridge.requestCheckin(fra.transaction_ref, 'FRA');
          displayNumber = bridgeResult.displayNumber;
        }

        const checkinResult: CheckinResult = {
          queueNumber: displayNumber,
          name: fra.fra,
          serviceType: 'FRA Registration',
        };

        setResult(checkinResult);
        setScreen('SUCCESS');

        // Print in background — don't block success screen
        window.electronAPI.printTicket({
          queueNumber: checkinResult.queueNumber,
          clientName: checkinResult.name,
          serviceType: checkinResult.serviceType,
        }).catch((err: unknown) => console.error('[KioskLayout] Print error:', err));
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

        const name = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
          .filter(Boolean)
          .join(' ');
        const serviceLabel = resolveServiceLabel(appt.service_id);

        let displayNumber: string;

        // Try direct API first (LAN), fall back to bridge (external)
        if (nexusApi.isAuthenticated()) {
          try {
            const apiResult = await nexusApi.checkin(appt.ref_code);
            displayNumber = String(apiResult.entry.queueNumber);
          } catch (apiErr) {
            console.warn('[KioskLayout] Direct API failed, trying bridge:', apiErr);
            const bridgeResult = await checkinBridge.requestCheckin(appt.ref_code, 'APPOINTMENT');
            displayNumber = bridgeResult.displayNumber;
          }
        } else {
          const bridgeResult = await checkinBridge.requestCheckin(appt.ref_code, 'APPOINTMENT');
          displayNumber = bridgeResult.displayNumber;
        }

        const checkinResult: CheckinResult = {
          queueNumber: displayNumber,
          name,
          serviceType: serviceLabel,
        };

        setResult(checkinResult);
        setScreen('SUCCESS');

        // Print in background — don't block success screen
        window.electronAPI.printTicket({
          queueNumber: checkinResult.queueNumber,
          clientName: checkinResult.name,
          serviceType: checkinResult.serviceType,
        }).catch((err: unknown) => console.error('[KioskLayout] Print error:', err));
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
