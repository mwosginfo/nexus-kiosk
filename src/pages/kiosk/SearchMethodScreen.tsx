import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone, faHashtag, faQrcode, faArrowLeft } from '@fortawesome/free-solid-svg-icons';

interface SearchMethodScreenProps {
  readonly appointmentType: 'regular' | 'fra';
  readonly onSelectMethod: (method: 'phone' | 'ref_code') => void;
  readonly onBack: () => void;
}

export function SearchMethodScreen({ appointmentType, onSelectMethod, onBack }: SearchMethodScreenProps) {
  return (
    <div className="kiosk-mode min-h-screen flex flex-col items-center justify-center bg-gray-50 px-12">
      {/* QR scan instruction */}
      <div className="text-center mb-16">
        <FontAwesomeIcon icon={faQrcode} className="text-gray-400 mb-6" style={{ fontSize: '6rem' }} />
        <h2 className="text-3xl font-bold text-gray-800 mb-3">Scan Your QR Code</h2>
        <p className="text-xl text-gray-500">Place your QR code in front of the scanner</p>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-6 mb-12 w-full max-w-md">
        <div className="flex-1 border-t border-gray-300" />
        <span className="text-gray-400 text-lg font-medium">or search manually</span>
        <div className="flex-1 border-t border-gray-300" />
      </div>

      {/* Manual search buttons */}
      <div className="flex gap-6">
        {appointmentType !== 'fra' && (
          <button
            onClick={() => onSelectMethod('phone')}
            className="w-56 h-40 rounded-2xl bg-white border-3 border-gray-200 hover:border-teal-500 hover:bg-teal-50 flex flex-col items-center justify-center gap-3 transition-all shadow-md hover:shadow-lg"
          >
            <FontAwesomeIcon icon={faPhone} className="text-teal-500 text-5xl" />
            <p className="text-xl font-bold text-gray-800">Phone Number</p>
          </button>
        )}

        <button
          onClick={() => onSelectMethod('ref_code')}
          className="w-56 h-40 rounded-2xl bg-white border-3 border-gray-200 hover:border-blue-500 hover:bg-blue-50 flex flex-col items-center justify-center gap-3 transition-all shadow-md hover:shadow-lg"
        >
          <FontAwesomeIcon icon={faHashtag} className="text-blue-500 text-5xl" />
          <p className="text-xl font-bold text-gray-800">
            {appointmentType === 'fra' ? 'Transaction Ref' : 'Reference Code'}
          </p>
        </button>
      </div>

      {/* Back button */}
      <button
        onClick={onBack}
        className="mt-12 px-8 py-3 text-lg text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors"
      >
        <FontAwesomeIcon icon={faArrowLeft} className="mr-2" />
        Back
      </button>
    </div>
  );
}
