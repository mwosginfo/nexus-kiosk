import { useEffect, useState } from 'react';
import { isFraCheckinOpen, FRA_CUTOFF_MESSAGE } from '../../lib/business-hours';
import { KioskHeader } from '../../components/KioskHeader';

interface TypeSelectScreenProps {
  readonly onSelect: (type: 'regular' | 'fra') => void;
}

export function TypeSelectScreen({ onSelect }: TypeSelectScreenProps) {
  const [fraBlocked, setFraBlocked] = useState(false);

  useEffect(() => {
    if (!fraBlocked) return;
    const t = setTimeout(() => setFraBlocked(false), 8_000);
    return () => clearTimeout(t);
  }, [fraBlocked]);

  function handleFraClick() {
    if (isFraCheckinOpen()) {
      onSelect('fra');
    } else {
      setFraBlocked(true);
    }
  }

  if (fraBlocked) {
    return (
      <div className="kiosk-mode w-full min-h-screen flex flex-col bg-brand-paper" aria-live="polite">
        <KioskHeader kicker="FRA / Employment Agency" />
        <button
          type="button"
          onClick={() => setFraBlocked(false)}
          className="flex-1 flex flex-col items-center justify-center px-12 text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-burgundy/30"
        >
          <p className="text-[clamp(0.8rem,0.9vw,1.1rem)] tracking-kicker font-semibold text-brand-burgundy uppercase mb-6">
            Submission Window Closed
          </p>
          <p className="text-[clamp(2rem,3.5vw,4rem)] font-bold text-brand-ink max-w-4xl leading-snug text-pretty">
            {FRA_CUTOFF_MESSAGE}
          </p>
          <p className="mt-12 text-[clamp(0.9rem,1vw,1.1rem)] text-gray-500 motion-safe:animate-pulse">
            Touch Anywhere to Go Back
          </p>
        </button>
        <div className="brand-strip" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="kiosk-mode w-full min-h-screen flex flex-col bg-brand-paper">
      <KioskHeader />

      <main className="flex-1 flex flex-col items-center justify-center px-[clamp(2rem,4vw,6rem)]">
        <p className="text-[clamp(0.8rem,0.9vw,1.1rem)] tracking-kicker font-semibold text-brand-navy uppercase mb-3">
          Step 1 of 2
        </p>
        <h2 className="text-[clamp(2rem,3.5vw,4.5rem)] font-extrabold text-brand-ink mb-3 text-center text-pretty">
          Select Your Appointment Type
        </h2>
        <p className="text-[clamp(1rem,1.2vw,1.4rem)] text-gray-500 mb-[clamp(2.5rem,4vw,5rem)]">
          Choose the category that applies to you
        </p>

        <div className="flex gap-[clamp(1.5rem,2.5vw,3rem)] w-full max-w-6xl">
          <button
            type="button"
            onClick={() => onSelect('regular')}
            className="group flex-1 aspect-[4/3] max-h-[420px] rounded-[2rem] bg-white border-2 border-gray-200 hover:border-brand-navy hover:-translate-y-1 transition-[border-color,transform,box-shadow] duration-200 shadow-sm hover:shadow-xl flex flex-col items-center justify-center px-8 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-navy/30"
          >
            <span className="block w-12 h-1 rounded-full bg-brand-navy mb-8 transition-[width] duration-200 group-hover:w-20" />
            <p className="text-[clamp(1.6rem,2.6vw,3.2rem)] font-extrabold text-brand-ink leading-tight text-center text-pretty">
              OFW / Employer
            </p>
          </button>

          <button
            type="button"
            onClick={handleFraClick}
            className="group flex-1 aspect-[4/3] max-h-[420px] rounded-[2rem] bg-white border-2 border-gray-200 hover:border-brand-burgundy hover:-translate-y-1 transition-[border-color,transform,box-shadow] duration-200 shadow-sm hover:shadow-xl flex flex-col items-center justify-center px-8 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-burgundy/30"
          >
            <span className="block w-12 h-1 rounded-full bg-brand-burgundy mb-8 transition-[width] duration-200 group-hover:w-20" />
            <p className="text-[clamp(1.6rem,2.6vw,3.2rem)] font-extrabold text-brand-ink leading-tight text-center text-pretty">
              FRA / Employment Agency
            </p>
          </button>
        </div>
      </main>

      <div className="brand-strip" aria-hidden="true" />
    </div>
  );
}
