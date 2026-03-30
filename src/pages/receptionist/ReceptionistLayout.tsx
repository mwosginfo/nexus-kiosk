import { useState } from 'react';
import { SearchPanel } from './SearchPanel';
import { CheckinPanel } from './CheckinPanel';
import { WalkInModal } from './WalkInModal';
import { StatusBanner } from '../../components/StatusBanner';
import { useMode } from '../../contexts/ModeContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faUserPlus, faBolt } from '@fortawesome/free-solid-svg-icons';
import * as queueService from '../../services/queue.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';
import mwoLogo from '../../assets/mwo_logo.png';

type SelectedItem =
  | { readonly type: 'appointment'; readonly data: AppointmentWithService }
  | { readonly type: 'fra'; readonly data: FraRegistrationRow };

export function ReceptionistLayout() {
  const { toggleSettings } = useMode();
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<{ queueNumber: string; name: string } | null>(null);
  const [owwaLoading, setOwwaLoading] = useState(false);

  function handleCheckinComplete(queueNumber: string, name: string) {
    setLastCheckin({ queueNumber, name });
    setSelected(null);
  }

  async function handleOwwaQuick() {
    setOwwaLoading(true);
    try {
      const assignment = await queueService.owwaQuickQueue();

      // Print in background
      window.electronAPI.printTicket({
        queueNumber: assignment.displayNumber,
        clientName: '',
        serviceType: 'OWWA',
      }).catch((err: unknown) => console.error('[OWWA Quick] Print error:', err));

      setLastCheckin({ queueNumber: assignment.displayNumber, name: 'OWWA Client' });
      setSelected(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'OWWA queue number failed');
    } finally {
      setOwwaLoading(false);
    }
  }

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
          <StatusBanner />
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
            selectedId={
              selected?.type === 'appointment'
                ? selected.data.id
                : selected?.type === 'fra'
                ? selected.data.id
                : null
            }
          />
        </div>

        {/* Right: Check-in Panel */}
        <div className="flex-1 overflow-y-auto p-6">
          <CheckinPanel
            selected={selected}
            lastCheckin={lastCheckin}
            onCheckinComplete={handleCheckinComplete}
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
        }}
      />
    </div>
  );
}
