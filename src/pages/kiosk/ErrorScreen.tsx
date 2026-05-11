import { useEffect } from 'react';
import { KioskHeader } from '../../components/KioskHeader';

interface ErrorScreenProps {
  readonly message?: string;
  readonly onRetry: () => void;
}

export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  useEffect(() => {
    const timer = setTimeout(onRetry, 6_000);
    return () => clearTimeout(timer);
  }, [onRetry]);

  return (
    <button
      type="button"
      onClick={onRetry}
      className="kiosk-mode w-full min-h-screen flex flex-col bg-brand-paper focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-burgundy/30"
    >
      <KioskHeader kicker="Unable to Check In" />

      <main className="flex-1 flex flex-col items-center justify-center px-[clamp(2rem,4vw,6rem)] text-center" role="alert" aria-live="assertive">
        <div className="w-16 h-1 rounded-full bg-brand-burgundy mb-[clamp(1.5rem,2vw,2.5rem)]" aria-hidden="true" />

        <p className="text-[clamp(1.5rem,2.4vw,3rem)] font-bold text-brand-ink leading-snug max-w-3xl text-pretty">
          {message || 'Please try again or see the receptionist for assistance.'}
        </p>

        <p className="mt-[clamp(1.5rem,2vw,2.5rem)] text-[clamp(0.85rem,0.95vw,1.1rem)] text-gray-400 motion-safe:animate-pulse">
          Touch Anywhere to Try Again
        </p>
      </main>

      <div className="brand-strip" aria-hidden="true" />
    </button>
  );
}
