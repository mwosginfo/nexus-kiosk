import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers, faBuilding } from '@fortawesome/free-solid-svg-icons';

interface TypeSelectScreenProps {
  readonly onSelect: (type: 'regular' | 'fra') => void;
}

export function TypeSelectScreen({ onSelect }: TypeSelectScreenProps) {
  return (
    <div className="kiosk-mode min-h-screen flex flex-col items-center justify-center bg-gray-50 px-12">
      <h2 className="text-3xl font-bold text-gray-800 mb-4">Select Your Appointment Type</h2>
      <p className="text-lg text-gray-500 mb-12">Choose the category that applies to you</p>

      <div className="flex gap-8">
        <button
          onClick={() => onSelect('regular')}
          className="w-80 h-64 rounded-3xl bg-white border-4 border-gray-200 hover:border-teal-500 hover:bg-teal-50 flex flex-col items-center justify-center gap-4 transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          <FontAwesomeIcon icon={faUsers} className="text-teal-500" style={{ fontSize: '5rem' }} />
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-800">OFW / Direct Hire</p>
            <p className="text-sm text-gray-500 mt-1">Employer Appointments</p>
          </div>
        </button>

        <button
          onClick={() => onSelect('fra')}
          className="w-80 h-64 rounded-3xl bg-white border-4 border-gray-200 hover:border-blue-500 hover:bg-blue-50 flex flex-col items-center justify-center gap-4 transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          <FontAwesomeIcon icon={faBuilding} className="text-blue-500" style={{ fontSize: '5rem' }} />
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-800">FRA / EA</p>
            <p className="text-sm text-gray-500 mt-1">Agency Registration</p>
          </div>
        </button>
      </div>
    </div>
  );
}
