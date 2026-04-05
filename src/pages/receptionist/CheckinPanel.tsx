import { useState } from 'react';
import { QueueNumberDisplay } from '../../components/QueueNumberDisplay';
import { resolveServiceLabel, todaySGT, isFutureDate, isWithinDaysAhead } from '../../lib/constants';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as queueService from '../../services/queue.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';

type SelectedItem =
  | { readonly type: 'appointment'; readonly data: AppointmentWithService }
  | { readonly type: 'fra'; readonly data: FraRegistrationRow };

interface CheckinPanelProps {
  readonly selected: SelectedItem | null;
  readonly lastCheckin: { queueNumber: string; name: string } | null;
  readonly onCheckinComplete: (queueNumber: string, name: string) => void;
  readonly autoPrint: boolean;
}

export function CheckinPanel({ selected, lastCheckin, onCheckinComplete, autoPrint }: CheckinPanelProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function handleCheckin(forceWalkIn = false) {
    if (!selected) return;
    setChecking(true);
    setError('');

    try {
      if (selected.type === 'appointment') {
        const appt = selected.data;

        // Block terminal statuses
        const rejected = ['cancelled', 'completed', 'no_show'];
        if (rejected.includes(appt.status)) {
          setError(`This appointment is ${appt.status} and cannot be checked in.`);
          setChecking(false);
          return;
        }

        const isFuture = isFutureDate(appt.appointment_date);

        // Future: block if beyond 14 days
        if (isFuture && !isWithinDaysAhead(appt.appointment_date, 14)) {
          setError(`Appointment is for ${appt.appointment_date}, which is more than 14 days ahead.`);
          setChecking(false);
          return;
        }

        // Check duplicate
        const dup = await queueService.checkDuplicate(appt.ref_code);
        if (dup) {
          setError(`Already checked in as Q#${dup.displayNumber}.`);
          setChecking(false);
          return;
        }

        const name = [appt.ofw_fname, appt.ofw_mname, appt.ofw_lname]
          .filter(Boolean)
          .join(' ');
        const serviceLabel = resolveServiceLabel(appt.service_id);

        // Future appointments approved by receptionist → check in as WALK-IN (W600 series)
        const useWalkIn = forceWalkIn || isFuture;

        const serviceInfo = await appointmentService.lookupServiceInfo(appt.service_id);

        const assignment = await queueService.checkinAndAssignQueue({
          refCode: appt.ref_code,
          appointmentType: useWalkIn ? 'WALKIN' : 'APPOINTMENT',
          queueSeries: useWalkIn ? 'WALKIN_REGULAR' : serviceInfo.series,
          serviceType: serviceInfo.serviceType,
          clientName: name,
          clientEmail: appt.client_email,
          appointmentId: appt.id,
          transactionRef: appt.ref_code,
        });

        // Mark appointment as arrived (fire-and-forget)
        appointmentService.markArrived(appt.id).catch(() => {});

        onCheckinComplete(assignment.displayNumber, name);

        // Print ticket (always print when receptionist approves, including future)
        if (autoPrint) {
          window.electronAPI.printTicket({
            queueNumber: assignment.displayNumber,
            clientName: name,
            serviceType: serviceLabel,
          }).catch((err: unknown) => console.error('[CheckinPanel] Print error:', err));
        }
      } else {
        const fra = selected.data;

        if (fra.status === 'completed' || fra.status === 'cancelled') {
          setError(`This FRA registration is ${fra.status} and cannot be checked in.`);
          setChecking(false);
          return;
        }

        const today = todaySGT();
        if (fra.appointment_date && fra.appointment_date > today) {
          setError(`FRA appointment is for ${fra.appointment_date}, which is in the future.`);
          setChecking(false);
          return;
        }

        const dup = await queueService.checkDuplicate(fra.transaction_ref);
        if (dup) {
          setError(`Already checked in as Q#${dup.displayNumber}.`);
          setChecking(false);
          return;
        }

        const assignment = await queueService.checkinAndAssignQueue({
          refCode: fra.transaction_ref,
          appointmentType: 'FRA',
          queueSeries: 'FRA',
          serviceType: 'FRA_REGISTRATION',
          clientName: fra.fra,
          transactionRef: fra.transaction_ref,
        });

        fraService.markArrived(fra.transaction_ref).catch(() => {});

        onCheckinComplete(assignment.displayNumber, fra.fra);

        if (autoPrint) {
          window.electronAPI.printTicket({
            queueNumber: assignment.displayNumber,
            clientName: fra.fra,
            serviceType: 'FRA Registration',
          }).catch((err: unknown) => console.error('[CheckinPanel] Print error:', err));
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Check-in failed';
      const isNetworkError = raw.includes('Failed to fetch') || raw.includes('NetworkError');
      setError(isNetworkError ? 'Cannot connect to server. Please check network connection.' : raw);
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

  // ─── No selection ──────────────────────────────────────────────────────
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

  // ─── Appointment detail ────────────────────────────────────────────────
  if (selected.type === 'appointment') {
    const a = selected.data;
    const name = [a.ofw_fname, a.ofw_mname, a.ofw_lname].filter(Boolean).join(' ');
    const serviceLabel = a.services?.name ?? resolveServiceLabel(a.service_id);

    const isNotToday = a.appointment_date !== todaySGT();
    const isFuture = isFutureDate(a.appointment_date);
    const isTerminal = ['cancelled', 'completed', 'no_show'].includes(a.status);
    const isDeferred = a.status === 'deferred' || a.appt_status === 'DEFERRED';

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-800">Appointment Details</h2>

        {isFuture && (
          <div className="text-sm text-blue-700 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3">
            <strong>Future appointment:</strong> Scheduled for <strong>{a.appointment_date}</strong>.
            Review details and approve below to check in as walk-in.
          </div>
        )}

        {isNotToday && !isFuture && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            This appointment was for <strong>{a.appointment_date}</strong> (past date).
          </div>
        )}

        {isDeferred && (
          <div className="text-sm text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
            This appointment was previously <strong>deferred</strong>. Re-check-in will issue a new queue number.
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
              <p className="text-gray-700">{a.status}</p>
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

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>
        )}

        {/* Future: two-step — "Approve & Check In as Walk-in" */}
        {isFuture && !isTerminal && (
          <button
            onClick={() => void handleCheckin(true)}
            disabled={checking}
            className="w-full py-4 text-lg font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking In...' : 'Approve & Check In as Walk-in'}
          </button>
        )}

        {/* Today / past: normal check-in */}
        {!isFuture && !isTerminal && (
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

  // ─── FRA detail ────────────────────────────────────────────────────────
  const f = selected.data;
  const isTerminalFra = f.status === 'completed' || f.status === 'cancelled';

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">FRA Registration Details</h2>

      <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <strong>Batch check-in:</strong> All contracts under this transaction ref will be checked in together.
      </div>

      {isTerminalFra && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          This FRA registration is <strong>{f.status}</strong> and cannot be checked in.
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
            <p className="text-gray-700">{f.appointment_date ?? 'N/A'}</p>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <button
        onClick={() => void handleCheckin()}
        disabled={checking || isTerminalFra}
        className="w-full py-4 text-lg font-bold text-white bg-blue-500 rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
      >
        {checking ? 'Checking In...' : 'Batch Check In & Print Ticket'}
      </button>
    </div>
  );
}
