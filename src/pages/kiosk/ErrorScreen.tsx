import { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleXmark } from '@fortawesome/free-solid-svg-icons';

interface ErrorScreenProps {
  readonly message?: string;
  readonly onRetry: () => void;
}

export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  // Auto-return to type select after 5 seconds
  useEffect(() => {
    const timer = setTimeout(onRetry, 5_000);
    return () => clearTimeout(timer);
  }, [onRetry]);

  return (
    <button
      onClick={onRetry}
      className="kiosk-mode w-full min-h-screen flex flex-col items-center justify-center bg-red-50"
    >
      <div className="text-center space-y-8">
        <FontAwesomeIcon icon={faCircleXmark} className="text-red-500" style={{ fontSize: '8rem' }} />

        <div className="space-y-3">
          <p className="text-3xl font-bold text-gray-800">
            Appointment Not Found
          </p>
          <p className="text-xl text-gray-500">
            Please try again or see the receptionist for assistance
          </p>
          {message && (
            <p className="text-sm text-red-400 font-mono mt-4 max-w-md mx-auto">
              {message}
            </p>
          )}
        </div>

        <p className="text-sm text-gray-400 animate-pulse">
          Touch anywhere to try again
        </p>
      </div>
    </button>
  );
}
