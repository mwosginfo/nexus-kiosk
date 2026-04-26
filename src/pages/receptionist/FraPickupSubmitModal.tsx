import { useState } from 'react';

interface FraPickupSubmitModalProps {
  readonly open: boolean;
  readonly fraName: string;
  readonly pickupCount: number;
  readonly deferredCount: number;
  readonly onConfirm: (choice: { pickup: boolean; submit: boolean }) => void;
  readonly onCancel: () => void;
}

/**
 * Modal shown when an FRA group has BOTH pickup-ready (status='completed')
 * and deferred (status='arrived' + staff_notes) contracts.
 *
 * Receptionist chooses what to issue queue numbers for:
 *  - Pickup only → 1 queue (A001)
 *  - Submit only → 1 queue (A001)
 *  - Both → 2 separate queues (A001 each, different remarks)
 */
export function FraPickupSubmitModal({
  open,
  fraName,
  pickupCount,
  deferredCount,
  onConfirm,
  onCancel,
}: FraPickupSubmitModalProps) {
  const [pickup, setPickup] = useState(true);
  const [submit, setSubmit] = useState(true);

  if (!open) return null;

  const noneSelected = !pickup && !submit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-2">FRA Group Has Mixed Contracts</h2>
        <p className="text-sm text-gray-500 mb-4">
          <strong>{fraName}</strong> has contracts ready for pickup AND contracts that were deferred.
          Choose what to issue queue numbers for. If both, two queue numbers will be issued.
        </p>

        <div className="space-y-3 mb-6">
          <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                 style={{ borderColor: pickup ? '#0d9488' : '#e5e7eb' }}>
            <input
              type="checkbox"
              checked={pickup}
              onChange={(e) => setPickup(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-gray-800">Pickup</div>
              <div className="text-xs text-gray-500">
                {pickupCount} contract{pickupCount !== 1 ? 's' : ''} ready for pickup (status: completed)
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                 style={{ borderColor: submit ? '#0d9488' : '#e5e7eb' }}>
            <input
              type="checkbox"
              checked={submit}
              onChange={(e) => setSubmit(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-gray-800">Submit (deferred)</div>
              <div className="text-xs text-gray-500">
                {deferredCount} deferred contract{deferredCount !== 1 ? 's' : ''} to re-submit
              </div>
            </div>
          </label>
        </div>

        {noneSelected && (
          <p className="text-xs text-amber-600 mb-3">Select at least one option.</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ pickup, submit })}
            disabled={noneSelected}
            className="px-6 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
