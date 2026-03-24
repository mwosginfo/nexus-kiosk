import { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';

interface SuccessScreenProps {
  readonly result: { queueNumber: string; name: string; serviceType: string } | null;
  readonly onDone: () => void;
}

export function SuccessScreen({ result, onDone }: SuccessScreenProps) {
  // Auto-return to splash after 8 seconds
  useEffect(() => {
    const timer = setTimeout(onDone, 8_000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <button
      onClick={onDone}
      className="kiosk-mode w-full min-h-screen flex flex-col items-center justify-center bg-green-50"
    >
      <div className="text-center space-y-8">
        <FontAwesomeIcon icon={faCircleCheck} className="text-green-600" style={{ fontSize: '8rem' }} />

        {/* Queue number */}
        {result && (
          <div>
            <p className="text-xl text-green-600 font-medium mb-2">Your Queue Number</p>
            <p className="text-8xl font-bold font-mono tracking-widest text-green-800">
              {result.queueNumber}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-3xl font-bold text-gray-800">
            Take your ticket and proceed to the consular area
          </p>
          <p className="text-lg text-gray-500">
            Please wait for your number to be called
          </p>
        </div>

        <p className="text-sm text-gray-400 animate-pulse">
          Touch anywhere to continue
        </p>
      </div>
    </button>
  );
}
