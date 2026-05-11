import { useState } from 'react';
import { FRA_LIST } from '../../lib/fra-data';
import * as queueService from '../../services/queue.service';

interface LostBookingModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: (queueNumber: string, name: string) => void;
  readonly autoPrint: boolean;
}

const MIN_WORKERS = 1;
const MAX_WORKERS = 50;

export function LostBookingModal({ open, onClose, onSuccess, autoPrint }: LostBookingModalProps) {
  const [fra, setFra] = useState('');
  const [workerCount, setWorkerCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setFra('');
    setWorkerCount(1);
    setError('');
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = fra.trim();
    if (!FRA_LIST.includes(trimmed)) {
      setError('Please select an FRA from the dropdown list.');
      return;
    }

    setSubmitting(true);
    try {
      const assignment = await queueService.lostBookingCheckin({
        fra: trimmed,
        workerCount,
      });

      const name = `${trimmed} (${workerCount} worker${workerCount === 1 ? '' : 's'})`;

      if (autoPrint) {
        window.electronAPI
          .printTicket({
            queueNumber: assignment.displayNumber,
            clientName: name,
            serviceType: 'FRA Registration (Lost Booking)',
          })
          .catch((err: unknown) => console.error('[LostBookingModal] Print error:', err));
      }

      resetForm();
      onSuccess(assignment.displayNumber, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue queue number.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-800">Agency Quick Queue — Lost Booking</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          For FRA appointments lost from backup. Issues an A-series queue number with
          only FRA + worker count — no registration record created.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              FRA (Foreign Recruitment Agency) *
            </label>
            <input
              required
              list="lost-booking-receptionist-fra-list"
              value={fra}
              onChange={(e) => setFra(e.target.value)}
              placeholder="Type to search..."
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
            <datalist id="lost-booking-receptionist-fra-list">
              {FRA_LIST.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Number of Workers *
            </label>
            <input
              required
              type="number"
              min={MIN_WORKERS}
              max={MAX_WORKERS}
              value={workerCount}
              onChange={(e) => {
                const n = Math.trunc(Number(e.target.value));
                if (!Number.isFinite(n)) return;
                setWorkerCount(Math.min(MAX_WORKERS, Math.max(MIN_WORKERS, n)));
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              {MIN_WORKERS}–{MAX_WORKERS} workers
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting ? 'Issuing...' : 'Issue Queue Number'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
