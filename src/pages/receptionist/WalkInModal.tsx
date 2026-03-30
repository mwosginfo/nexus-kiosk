import { useState } from 'react';
import { SERVICE_LABELS, OFW_TRANS_OPTIONS } from '../../lib/constants';
import * as queueService from '../../services/queue.service';

interface WalkInModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: (queueNumber: string, name: string, serviceLabel: string) => void;
}

export function WalkInModal({ open, onClose, onSuccess }: WalkInModalProps) {
  const [serviceType, setServiceType] = useState<'SKILLED_CV' | 'MDW_CV'>('MDW_CV');
  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [mname, setMname] = useState('');
  const [gender, setGender] = useState('');
  const [email, setEmail] = useState('');
  const [ofwTrans, setOfwTrans] = useState<string>(OFW_TRANS_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setServiceType('MDW_CV');
    setFname('');
    setLname('');
    setMname('');
    setGender('');
    setEmail('');
    setOfwTrans(OFW_TRANS_OPTIONS[0]);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const assignment = await queueService.walkInCheckin({
        fname: fname.trim(),
        lname: lname.trim(),
        mname: mname.trim() || undefined,
        gender,
        email: email.trim(),
        ofwTrans: ofwTrans,
        serviceType,
      });

      const name = [fname.trim(), mname.trim(), lname.trim()].filter(Boolean).join(' ');
      const serviceLabel = SERVICE_LABELS[serviceType] ?? serviceType;

      // Print in background
      window.electronAPI.printTicket({
        queueNumber: assignment.displayNumber,
        clientName: name,
        serviceType: serviceLabel,
      }).catch((err: unknown) => console.error('[WalkInModal] Print error:', err));

      resetForm();
      onSuccess(assignment.displayNumber, name, serviceLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Walk-in registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Walk-In Registration</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Service type */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setServiceType('MDW_CV')}
              className={`flex-1 py-2 text-sm rounded-lg border-2 font-medium ${
                serviceType === 'MDW_CV'
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-gray-200 text-gray-500'
              }`}
            >
              MDW - Contract Verification
            </button>
            <button
              type="button"
              onClick={() => setServiceType('SKILLED_CV')}
              className={`flex-1 py-2 text-sm rounded-lg border-2 font-medium ${
                serviceType === 'SKILLED_CV'
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-gray-200 text-gray-500'
              }`}
            >
              Skilled Worker - CV
            </button>
          </div>

          {/* Name */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">First Name *</label>
              <input
                required
                value={fname}
                onChange={(e) => setFname(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Middle Name</label>
              <input
                value={mname}
                onChange={(e) => setMname(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Last Name *</label>
              <input
                required
                value={lname}
                onChange={(e) => setLname(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Gender + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Gender *</label>
              <select
                required
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="">Select...</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          {/* OFW Transaction type */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Transaction Type *</label>
            <select
              required
              value={ofwTrans}
              onChange={(e) => setOfwTrans(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              {OFW_TRANS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => { resetForm(); onClose(); }}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 text-sm text-white bg-teal-500 rounded-lg hover:bg-teal-600 disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register & Print Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
