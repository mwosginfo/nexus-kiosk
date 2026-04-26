import { useState, useMemo } from 'react';
import QRCode from 'qrcode';
import { PRA_LB, PRA_SB } from '../../lib/pra-data';
import { FRA_LIST } from '../../lib/fra-data';
import * as urgentFraService from '../../services/urgent-fra.service';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';

interface UrgentFraModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

interface WorkerForm {
  last_name: string;
  first_name: string;
  middle_name: string;
}

type Step = 'form' | 'success';

const MAX_WORKERS = 15;

function emptyWorker(): WorkerForm {
  return { last_name: '', first_name: '', middle_name: '' };
}

export function UrgentFraModal({ open, onClose, onSuccess }: UrgentFraModalProps) {
  const [step, setStep] = useState<Step>('form');
  const [pra, setPra] = useState('');
  const [fra, setFra] = useState('');
  const [workers, setWorkers] = useState<WorkerForm[]>([emptyWorker()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultQrDataUrl, setResultQrDataUrl] = useState('');

  const praList = useMemo(() => [...PRA_LB, ...PRA_SB], []);

  function resetAll() {
    setStep('form');
    setPra('');
    setFra('');
    setWorkers([emptyWorker()]);
    setError('');
    setResultUrl('');
    setResultQrDataUrl('');
  }

  function handleClose() {
    resetAll();
    onClose();
  }

  function updateWorker(index: number, field: keyof WorkerForm, value: string) {
    setWorkers((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  }

  function addWorker() {
    if (workers.length >= MAX_WORKERS) return;
    setWorkers((prev) => [...prev, emptyWorker()]);
  }

  function removeWorker(index: number) {
    if (workers.length <= 1) return;
    setWorkers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (!praList.includes(pra)) {
        throw new Error('Please select a PRA from the list.');
      }
      if (!FRA_LIST.includes(fra)) {
        throw new Error('Please select an FRA from the list.');
      }

      const result = await urgentFraService.createUrgentFraInvitation({
        pra,
        fra,
        workers,
      });

      const qrDataUrl = await QRCode.toDataURL(result.url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 400,
      });

      window.electronAPI.printQrTicket({
        title: 'URGENT FRA REGISTRATION',
        qrDataUrl,
        pra,
        fra,
        contractCount: workers.length,
        instructions:
          '<ol>' +
          '<li>Scan QR with your phone camera.</li>' +
          '<li>Open the link to complete the FRA registration form.</li>' +
          '<li>Fill in worker business details &amp; submit.</li>' +
          '<li>Return to reception with the transaction ref to get your queue number.</li>' +
          '<li>Link expires in 48 hours.</li>' +
          '</ol>',
      }).catch((err: unknown) => console.error('[UrgentFraModal] Print error:', err));

      setResultUrl(result.url);
      setResultQrDataUrl(qrDataUrl);
      setStep('success');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Urgent FRA creation failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Urgent FRA Registration</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {step === 'form' && (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Walk-in FRA without prior appointment. The client will receive a printed QR
              code to complete the business details on their phone.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* PRA */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  PRA (Philippine Recruitment Agency) *
                </label>
                <input
                  required
                  list="urgent-pra-list"
                  value={pra}
                  onChange={(e) => setPra(e.target.value)}
                  placeholder="Type to search..."
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <datalist id="urgent-pra-list">
                  {praList.map((p) => <option key={p} value={p} />)}
                </datalist>
              </div>

              {/* FRA */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  FRA (Foreign Recruitment Agency) *
                </label>
                <input
                  required
                  list="urgent-fra-list"
                  value={fra}
                  onChange={(e) => setFra(e.target.value)}
                  placeholder="Type to search..."
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <datalist id="urgent-fra-list">
                  {FRA_LIST.map((f) => <option key={f} value={f} />)}
                </datalist>
              </div>

              {/* Workers */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-600">
                    Workers ({workers.length} contract{workers.length !== 1 ? 's' : ''})
                  </label>
                  <button
                    type="button"
                    onClick={addWorker}
                    disabled={workers.length >= MAX_WORKERS}
                    className="text-xs px-2 py-1 bg-teal-100 text-teal-700 rounded hover:bg-teal-200 disabled:opacity-50 flex items-center gap-1"
                  >
                    <FontAwesomeIcon icon={faPlus} className="text-xs" />
                    Add Worker
                  </button>
                </div>
                <div className="space-y-2">
                  {workers.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-2 w-6 flex-shrink-0">{i + 1}.</span>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <input
                          required
                          value={w.last_name}
                          onChange={(e) => updateWorker(i, 'last_name', e.target.value)}
                          placeholder="Last name *"
                          className="px-2 py-1.5 border rounded text-sm"
                        />
                        <input
                          required
                          value={w.first_name}
                          onChange={(e) => updateWorker(i, 'first_name', e.target.value)}
                          placeholder="First name *"
                          className="px-2 py-1.5 border rounded text-sm"
                        />
                        <input
                          value={w.middle_name}
                          onChange={(e) => updateWorker(i, 'middle_name', e.target.value)}
                          placeholder="Middle name"
                          className="px-2 py-1.5 border rounded text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeWorker(i)}
                        disabled={workers.length <= 1}
                        className="mt-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                        title="Remove worker"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Maximum 15 workers per registration.</p>
              </div>

              {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

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
                  className="px-6 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create & Print QR'}
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'success' && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-800">QR Code Printed</p>
              <p className="text-sm text-gray-500">
                Hand the printed QR to the client to complete their registration.
              </p>
            </div>

            {resultQrDataUrl && (
              <div className="flex justify-center">
                <img
                  src={resultQrDataUrl}
                  alt="QR Code"
                  className="w-48 h-48 border border-gray-200 rounded"
                />
              </div>
            )}

            <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
              <p><strong>PRA:</strong> {pra}</p>
              <p><strong>FRA:</strong> {fra}</p>
              <p><strong>Contracts:</strong> {workers.length}</p>
              <p className="break-all text-gray-500"><strong>URL:</strong> {resultUrl}</p>
            </div>

            <p className="text-xs text-gray-400">
              The client returns to reception with the transaction ref after submission to get their queue number.
            </p>

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { resetAll(); }}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                New Registration
              </button>
              <button
                onClick={handleClose}
                className="px-6 py-2 text-sm text-white bg-teal-500 rounded-lg hover:bg-teal-600"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
