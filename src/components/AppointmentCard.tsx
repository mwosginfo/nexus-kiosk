import type { AppointmentWithService } from '../schemas/appointment.schema';
import { SERVICE_LABELS } from '../lib/constants';

interface AppointmentCardProps {
  readonly appointment: AppointmentWithService;
  readonly selected?: boolean;
  readonly onClick?: () => void;
}

export function AppointmentCard({ appointment, selected, onClick }: AppointmentCardProps) {
  const a = appointment;
  const name = [a.client_fname, a.client_mname, a.client_lname].filter(Boolean).join(' ');
  const serviceLabel = a.services?.name ?? SERVICE_LABELS[a.service_id] ?? 'Unknown Service';

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    confirmed: 'bg-green-100 text-green-700',
    completed: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-100 text-red-600',
    no_show: 'bg-gray-100 text-gray-400',
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
        selected
          ? 'border-teal-500 bg-teal-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-800">{name}</p>
          <p className="text-sm text-gray-500">{serviceLabel}</p>
          <p className="text-xs text-gray-400 mt-1">
            {a.appointment_date} {a.start_time}
            {a.client_contact ? ` \u2022 ${a.client_contact}` : a.client_email ? ` \u2022 ${a.client_email}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {a.status}
          </span>
          <span className="text-xs font-mono text-gray-400">{a.ref_code}</span>
        </div>
      </div>
    </button>
  );
}
