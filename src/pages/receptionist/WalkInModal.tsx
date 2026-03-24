import { useState } from 'react';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as checkinBridge from '../../services/checkin-bridge.service';

import { getServiceId, SERVICE_SLUG_MAP } from '../../lib/constants';

type WalkInType = 'regular' | 'fra';

const REGULAR_SERVICE_OPTIONS = [
  { value: 'MDW_CV', label: 'MDW - Contract Verification' },
  { value: 'SKILLED_CV', label: 'Skilled Worker - CV' },
  { value: 'OWWA', label: 'OWWA' },
  { value: 'DH', label: 'Direct Hire' },
  { value: 'ACCREDITATION', label: 'Accreditation' },
] as const;

interface WalkInModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: (queueNumber: string, name: string) => void;
}

export function WalkInModal({ open, onClose, onSuccess }: WalkInModalProps) {
  const [type, setType] = useState<WalkInType>('regular');
  const [serviceType, setServiceType] = useState('MDW_CV');
  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setType('regular');
    setServiceType('MDW_CV');
    setFname('');
    setLname('');
    setEmail('');
    setPhone('');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const name = `${fname.trim()} ${lname.trim()}`;
      let refCode: string;
      let bridgeType: 'APPOINTMENT' | 'FRA';

      if (type === 'fra') {
        // 1. Create FRA walk-in in Supabase
        refCode = await fraService.createWalkInFra({
          agencyName: fname.trim(), // FRA uses agency name
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          personnel: lname.trim(),
        });
        bridgeType = 'FRA';
      } else {
        // 1. Create regular walk-in appointment in Supabase
        const serviceId = getServiceId(serviceType);
        const serviceSlug = SERVICE_SLUG_MAP[serviceType] ?? 'skilled-cv';

        refCode = await appointmentService.createWalkInAppointment({
          fname: fname.trim(),
          lname: lname.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          serviceSlug,
          serviceId,
        });
        bridgeType = 'APPOINTMENT';
      }

      // 2. Request queue number via bridge
      const bridgeResult = await checkinBridge.requestCheckin(refCode, bridgeType);

      // 3. Print ticket
      const svc = type === 'fra' ? 'FRA REGISTRATION' : serviceType.replace(/_/g, ' ');
      await window.electronAPI.printTicket({
        queueNumber: bridgeResult.displayNumber,
        clientName: name,
        serviceType: svc,
      });

      resetForm();
      onSuccess(bridgeResult.displayNumber, name);
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
          {/* Type */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('regular')}
              className={`flex-1 py-2 text-sm rounded-lg border-2 font-medium ${
                type === 'regular'
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-gray-200 text-gray-500'
              }`}
            >
              Regular Appointment
            </button>
            <button
              type="button"
              onClick={() => setType('fra')}
              className={`flex-1 py-2 text-sm rounded-lg border-2 font-medium ${
                type === 'fra'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500'
              }`}
            >
              FRA Registration
            </button>
          </div>

          {/* Service type (regular only) */}
          {type === 'regular' && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Service Type</label>
              <select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {REGULAR_SERVICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
              <label className="block text-sm font-medium text-gray-600 mb-1">Last Name *</label>
              <input
                required
                value={lname}
                onChange={(e) => setLname(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+65..."
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
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
