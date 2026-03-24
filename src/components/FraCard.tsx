import type { FraRegistrationRow } from '../schemas/fra.schema';

interface FraCardProps {
  readonly fra: FraRegistrationRow;
  readonly selected?: boolean;
  readonly onClick?: () => void;
}

export function FraCard({ fra, selected, onClick }: FraCardProps) {
  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    arrived: 'bg-green-100 text-green-700',
    completed: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-100 text-red-600',
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-800">{fra.fra}</p>
          <p className="text-sm text-gray-500">
            {fra.agency_personnel} &bull; {fra.workers.length} worker{fra.workers.length !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            PRA: {fra.pra} &bull; {fra.appointment_date}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[fra.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {fra.status}
          </span>
          <span className="text-xs font-mono text-gray-400">{fra.transaction_ref.slice(0, 8)}</span>
        </div>
      </div>
    </button>
  );
}
