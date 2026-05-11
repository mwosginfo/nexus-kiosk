import { useEffect } from 'react';
import { KioskHeader } from '../../components/KioskHeader';

interface SuccessScreenProps {
  readonly result: { queueNumber: string; name: string; serviceType: string } | null;
  readonly onDone: () => void;
}

export function SuccessScreen({ result, onDone }: SuccessScreenProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, 8_000);
    return () => clearTimeout(timer);
  }, [onDone]);

  const isPickup = result?.serviceType.startsWith('PICKUP') ?? false;

  return (
    <button
      type="button"
      onClick={onDone}
      className="kiosk-mode w-full min-h-screen flex flex-col bg-brand-paper focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-navy/30"
    >
      <KioskHeader kicker={isPickup ? 'Pickup' : 'Check-in Successful'} />

      <main className="flex-1 flex flex-col items-center justify-center px-[clamp(2rem,4vw,6rem)] text-center" aria-live="polite">
        {result && (
          <>
            <p className="text-[clamp(0.8rem,0.9vw,1.1rem)] tracking-kicker font-semibold text-brand-navy uppercase mb-3">
              Your Queue Number
            </p>
            <p
              className="font-mono font-extrabold text-brand-navy leading-none tracking-tight text-[clamp(8rem,18vw,22rem)]"
              style={{ fontVariantNumeric: 'tabular-nums' }}
              translate="no"
            >
              {result.queueNumber}
            </p>
            <div className="mt-6 inline-flex items-center gap-3 px-[clamp(1.2rem,1.6vw,2rem)] py-[clamp(0.5rem,0.7vw,0.9rem)] rounded-full bg-brand-navy/10 border border-brand-navy/20">
              <span className="text-[clamp(1rem,1.3vw,1.5rem)] font-semibold text-brand-navy uppercase tracking-wide">
                {result.serviceType}
              </span>
            </div>
            {result.name && (
              <p className="mt-4 text-[clamp(1.1rem,1.5vw,1.8rem)] text-brand-ink font-medium text-pretty">
                {result.name}
              </p>
            )}
          </>
        )}

        <div className="mt-[clamp(2rem,3vw,4rem)] max-w-3xl">
          <p className="text-[clamp(1.2rem,1.6vw,2rem)] font-bold text-brand-ink leading-snug text-pretty">
            Take Your Ticket and Proceed to the Consular Area
          </p>
          <p className="mt-2 text-[clamp(0.9rem,1.1vw,1.25rem)] text-gray-500">
            Please wait for your number to be called.
          </p>
        </div>

        <p className="mt-[clamp(1.5rem,2vw,2.5rem)] text-[clamp(0.85rem,0.95vw,1.1rem)] text-gray-400 motion-safe:animate-pulse">
          Touch Anywhere to Continue
        </p>
      </main>

      <div className="brand-strip" aria-hidden="true" />
    </button>
  );
}
