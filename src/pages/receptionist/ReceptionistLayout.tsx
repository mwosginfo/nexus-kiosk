import { useState, useEffect, useCallback } from 'react';
import { SearchPanel } from './SearchPanel';
import { CheckinPanel } from './CheckinPanel';
import { WalkInModal } from './WalkInModal';
import { UrgentFraModal } from './UrgentFraModal';
import { LostBookingModal } from './LostBookingModal';
import { StatusBanner } from '../../components/StatusBanner';
import { useMode } from '../../contexts/ModeContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faUserPlus, faBolt, faPrint, faTriangleExclamation, faFileCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { getSupabaseWriter } from '../../services/supabase.client';
import { todaySGT } from '../../lib/constants';
import * as queueService from '../../services/queue.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';
import type { SubmissionRow } from '../../schemas/submission.schema';
import mwoLogo from '../../assets/mwo_logo.png';

type SelectedItem =
  | { readonly type: 'appointment'; readonly data: AppointmentWithService }
  | { readonly type: 'fra'; readonly data: FraRegistrationRow }
  | { readonly type: 'submission'; readonly data: SubmissionRow };

interface QueueStats {
  readonly checkedIn: number;
  readonly waiting: number;
  readonly served: number;
}

export function ReceptionistLayout() {
  const { toggleSettings, settings, updateSettings } = useMode();
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [urgentFraOpen, setUrgentFraOpen] = useState(false);
  const [lostBookingOpen, setLostBookingOpen] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<{ queueNumber: string; name: string } | null>(null);
  const [owwaLoading, setOwwaLoading] = useState(false);
  const [stats, setStats] = useState<QueueStats>({ checkedIn: 0, waiting: 0, served: 0 });

  const autoPrint = settings?.autoPrint ?? true;

  // ─── Fetch queue stats ────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const supabase = getSupabaseWriter();
      const today = todaySGT();

      const { data, error } = await supabase
        .from('kiosk_checkins')
        .select('status')
        .eq('queue_date', today);

      if (error || !data) return;

      const rows = data as ReadonlyArray<{ status: string }>;
      const checkedIn = rows.length;
      const waiting = rows.filter((r) => r.status === 'WAITING' || r.status === 'CALLED').length;
      const served = rows.filter((r) =>
        !['WAITING', 'CALLED', 'PENDING', 'FAILED', 'MISSED', 'DEFERRED'].includes(r.status),
      ).length;

      setStats({ checkedIn, waiting, served });
    } catch {
      // Silently fail — stats are informational only
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    const interval = setInterval(() => void fetchStats(), 15_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ─── Handlers ───────────────────────────────────────────────────────
  function handleCheckinComplete(queueNumber: string, name: string) {
    setLastCheckin({ queueNumber, name });
    setSelected(null);
    void fetchStats();
  }

  function handleToggleAutoPrint() {
    void updateSettings({ autoPrint: !autoPrint });
  }

  async function handleOwwaQuick() {
    setOwwaLoading(true);
    try {
      const assignment = await queueService.owwaQuickQueue();

      // Print in background (if auto-print enabled)
      if (autoPrint) {
        window.electronAPI.printTicket({
          queueNumber: assignment.displayNumber,
          clientName: '',
          serviceType: 'OWWA',
        }).catch((err: unknown) => console.error('[OWWA Quick] Print error:', err));
      }

      setLastCheckin({ queueNumber: assignment.displayNumber, name: 'OWWA Client' });
      setSelected(null);
      void fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'OWWA queue number failed');
    } finally {
      setOwwaLoading(false);
    }
  }

  const selectedId =
    selected?.type === 'appointment' ? selected.data.id
    : selected?.type === 'fra' ? selected.data.id
    : selected?.type === 'submission' ? selected.data.ref_code
    : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={mwoLogo} alt="MWO" className="w-8 h-8 object-contain" />
          <h1 className="text-lg font-bold text-gray-800">Nexus Kiosk</h1>
          <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
            Receptionist
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Stats */}
          <div className="flex items-center gap-4 mr-4 text-xs font-medium">
            <span className="text-gray-500">
              Checked in: <span className="text-gray-800 font-bold">{stats.checkedIn}</span>
            </span>
            <span className="text-gray-500">
              Waiting: <span className="text-amber-600 font-bold">{stats.waiting}</span>
            </span>
            <span className="text-gray-500">
              Served: <span className="text-green-600 font-bold">{stats.served}</span>
            </span>
          </div>

          <StatusBanner />

          {/* Auto-print toggle */}
          <button
            onClick={handleToggleAutoPrint}
            className={`p-2 rounded-lg border transition-colors ${
              autoPrint
                ? 'text-teal-600 bg-teal-50 border-teal-200 hover:bg-teal-100'
                : 'text-gray-400 bg-gray-50 border-gray-200 hover:bg-gray-100'
            }`}
            title={autoPrint ? 'Auto-print ON (click to disable)' : 'Auto-print OFF (click to enable)'}
          >
            <FontAwesomeIcon icon={faPrint} />
          </button>

          <button
            onClick={() => void handleOwwaQuick()}
            disabled={owwaLoading}
            className="px-4 py-2 text-sm text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2"
            title="Generate OWWA queue number (no client details)"
          >
            <FontAwesomeIcon icon={faBolt} />
            {owwaLoading ? '...' : 'OWWA'}
          </button>
          <button
            onClick={() => setUrgentFraOpen(true)}
            className="px-4 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600 flex items-center gap-2"
            title="Urgent FRA — walk-in agency registration"
          >
            <FontAwesomeIcon icon={faTriangleExclamation} />
            Urgent FRA
          </button>
          <button
            onClick={() => setLostBookingOpen(true)}
            className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 flex items-center gap-2"
            title="Agency Quick Queue for bookings lost from backup"
          >
            <FontAwesomeIcon icon={faFileCircleExclamation} />
            Lost Booking
          </button>
          <button
            onClick={() => setWalkInOpen(true)}
            className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 flex items-center gap-2"
          >
            <FontAwesomeIcon icon={faUserPlus} />
            Walk-In
          </button>
          <button
            onClick={toggleSettings}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            title="Settings (Ctrl+Shift+S)"
          >
            <FontAwesomeIcon icon={faGear} className="text-lg" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Left: Search Panel */}
        <div className="w-2/5 border-r bg-white overflow-y-auto">
          <SearchPanel
            onSelectAppointment={(a) => setSelected({ type: 'appointment', data: a })}
            onSelectFra={(f) => setSelected({ type: 'fra', data: f })}
            onSelectSubmission={(s) => setSelected({ type: 'submission', data: s })}
            selectedId={selectedId}
          />
        </div>

        {/* Right: Check-in Panel */}
        <div className="flex-1 overflow-y-auto p-6">
          <CheckinPanel
            selected={selected}
            lastCheckin={lastCheckin}
            onCheckinComplete={handleCheckinComplete}
            autoPrint={autoPrint}
          />
        </div>
      </div>

      {/* Walk-In Modal */}
      <WalkInModal
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        onSuccess={(queueNumber, name) => {
          setWalkInOpen(false);
          setLastCheckin({ queueNumber, name });
          void fetchStats();
        }}
      />

      {/* Urgent FRA Modal */}
      <UrgentFraModal
        open={urgentFraOpen}
        onClose={() => setUrgentFraOpen(false)}
        onSuccess={() => {
          // Stats don't change here — invitation is created, not a check-in.
          // Client returns later with transaction_ref for actual check-in.
        }}
      />

      {/* Lost Booking Modal */}
      <LostBookingModal
        open={lostBookingOpen}
        onClose={() => setLostBookingOpen(false)}
        onSuccess={(queueNumber, name) => {
          setLostBookingOpen(false);
          setLastCheckin({ queueNumber, name });
          void fetchStats();
        }}
        autoPrint={autoPrint}
      />
    </div>
  );
}
