import { useState } from 'react';
import { QueueNumberDisplay } from '../../components/QueueNumberDisplay';
import { SERVICE_LABELS } from '../../lib/constants';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as checkinBridge from '../../services/checkin-bridge.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';

type SelectedItem =
  | { readonly type: 'appointment'; readonly data: AppointmentWithService }
  | { readonly type: 'fra'; readonly data: FraRegistrationRow };

interface CheckinPanelProps {
  readonly selected: SelectedItem | null;
  readonly lastCheckin: { queueNumber: string; name: string } | null;
  readonly onCheckinComplete: (queueNumber: string, name: string) => void;
}

export function CheckinPanel({ selected, lastCheckin, onCheckinComplete }: CheckinPanelProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function handleCheckin() {
    if (!selected) return;
    setChecking(true);
    setError('');

    try {
      if (selected.type === 'appointment') {
        const appt = selected.data;

        // 1. Mark arrived on Supabase
        await appointmentService.markArrived(appt.id);

        // 2. Request queue number via bridge (Nexus picks up from kiosk_checkins)
        const result = await checkinBridge.requestCheckin(appt.ref_code, 'APPOINTMENT');

        // 3. Print ticket
        const name = [appt.client_fname, appt.client_mname, appt.client_lname]
          .filter(Boolean)
          .join(' ');

        await window.electronAPI.printTicket({
          queueNumber: result.displayNumber,
          clientName: name,
          serviceType: result.serviceType,
        });

        onCheckinComplete(result.displayNumber, name);
      } else {
        const fra = selected.data;

        // 1. Mark arrived on Supabase
        await fraService.markArrived(fra.id);

        // 2. Request queue number via bridge
        const result = await checkinBridge.requestCheckin(fra.transaction_ref, 'FRA');

        // 3. Print ticket
        await window.electronAPI.printTicket({
          queueNumber: result.displayNumber,
          clientName: fra.fra,
          serviceType: 'FRA REGISTRATION',
        });

        onCheckinComplete(result.displayNumber, fra.fra);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setChecking(false);
    }
  }

  async function handleReprint() {
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

  // No selection — show last checkin or empty state
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

  // Selected appointment detail
  if (selected.type === 'appointment') {
    const a = selected.data;
    const name = [a.client_fname, a.client_mname, a.client_lname].filter(Boolean).join(' ');
    const serviceLabel = a.services?.name ?? SERVICE_LABELS[a.service_id] ?? a.service_id;
    const isAlreadyArrived = a.appt_status === 'ARRIVED';

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-800">Appointment Details</h2>

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
              <p className="text-gray-700">{a.status} {a.appt_status ? ` (${a.appt_status})` : ''}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Date / Time</p>
              <p className="text-gray-700">{a.appointment_date} {a.start_time}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Contact</p>
              <p className="text-gray-700">{a.client_contact ?? a.client_email}</p>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>
        )}

        {isAlreadyArrived ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-700 text-sm">
            This appointment is already marked as arrived.
          </div>
        ) : (
          <button
            onClick={() => void handleCheckin()}
            disabled={checking}
            className="w-full py-4 text-lg font-bold text-white bg-teal-500 rounded-xl hover:bg-teal-600 disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking In...' : 'Check In & Print Ticket'}
          </button>
        )}
      </div>
    );
  }

  // Selected FRA detail
  const f = selected.data;
  const isAlreadyArrived = f.status === 'arrived';

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">FRA Registration Details</h2>

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
            <p className="text-xs text-gray-400 uppercase">Workers</p>
            <p className="text-gray-700">{f.workers.length} worker{f.workers.length !== 1 ? 's' : ''}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Status</p>
            <p className="text-gray-700">{f.status}</p>
          </div>
        </div>

        {/* Worker list */}
        {f.workers.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 uppercase mb-2">Workers</p>
            <div className="space-y-1">
              {f.workers.map((w, i) => (
                <p key={i} className="text-sm text-gray-600">
                  {i + 1}. {w.last_name}, {w.first_name} {w.middle_name ?? ''} — {w.employer}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      {isAlreadyArrived ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-700 text-sm">
          This FRA registration is already marked as arrived.
        </div>
      ) : (
        <button
          onClick={() => void handleCheckin()}
          disabled={checking}
          className="w-full py-4 text-lg font-bold text-white bg-blue-500 rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {checking ? 'Checking In...' : 'Check In & Print Ticket'}
        </button>
      )}
    </div>
  );
}
