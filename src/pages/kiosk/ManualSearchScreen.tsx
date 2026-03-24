import { useState } from 'react';
import { OnScreenKeyboard } from '../../components/OnScreenKeyboard';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';

interface ManualSearchScreenProps {
  readonly searchMode: 'phone' | 'ref_code';
  readonly loading: boolean;
  readonly onSearch: (value: string) => void;
  readonly onBack: () => void;
}

export function ManualSearchScreen({ searchMode, loading, onSearch, onBack }: ManualSearchScreenProps) {
  const [value, setValue] = useState('');

  function handleSubmit() {
    if (value.trim() && !loading) {
      onSearch(value.trim());
    }
  }

  return (
    <div className="kiosk-mode min-h-screen flex flex-col items-center justify-center bg-gray-50 px-12">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">
        {searchMode === 'phone' ? 'Enter Your Phone Number' : 'Enter Your Reference Code'}
      </h2>
      <p className="text-gray-500 mb-8">
        {searchMode === 'phone'
          ? 'Use the number registered with your appointment'
          : 'Enter the 8-character code from your confirmation'
        }
      </p>

      {/* Display input */}
      <div className="w-full max-w-md mb-8">
        <div className="flex items-center bg-white border-2 border-gray-300 rounded-xl px-6 py-4 text-3xl font-mono tracking-widest text-center min-h-[72px]">
          <span className="flex-1 text-center">
            {value || <span className="text-gray-300">{searchMode === 'phone' ? '+65...' : 'ABCD1234'}</span>}
          </span>
          {value && (
            <button
              onClick={() => setValue('')}
              className="text-gray-400 hover:text-gray-600 text-xl ml-2"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Loading indicator */}
      {loading ? (
        <div className="text-xl text-gray-500 animate-pulse py-12">Searching...</div>
      ) : (
        <OnScreenKeyboard
          mode={searchMode === 'phone' ? 'numeric' : 'alphanumeric'}
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
        />
      )}

      {/* Back button */}
      <button
        onClick={onBack}
        className="mt-8 px-8 py-3 text-lg text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors"
      >
        <FontAwesomeIcon icon={faArrowLeft} className="mr-2" />
        Back
      </button>
    </div>
  );
}
