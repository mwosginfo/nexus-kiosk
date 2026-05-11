import { useState } from 'react';
import { OnScreenKeyboard } from '../../components/OnScreenKeyboard';
import { KioskHeader } from '../../components/KioskHeader';

interface EntryScreenProps {
  readonly appointmentType: 'regular' | 'fra';
  readonly loading: boolean;
  readonly onSubmit: (refCode: string) => void;
  readonly onBack: () => void;
}

export function EntryScreen({ appointmentType, loading, onSubmit, onBack }: EntryScreenProps) {
  const [value, setValue] = useState('');

  const isFra = appointmentType === 'fra';
  const placeholder = isFra ? 'TRANSACTION REF' : 'REFERENCE CODE';
  const accentHex = isFra ? '#b02f47' : '#2a4090';
  const subhead = isFra
    ? 'Enter your FRA transaction reference'
    : 'Scan the QR on your confirmation, or enter the reference code below';

  function handleSubmit() {
    const trimmed = value.trim();
    if (trimmed && !loading) onSubmit(trimmed);
  }

  return (
    <div className="kiosk-mode w-full min-h-screen flex flex-col bg-brand-paper">
      <KioskHeader kicker={isFra ? 'FRA / Employment Agency' : 'OFW / Employer'} />

      <main className="flex-1 flex flex-col items-center justify-center px-[clamp(2rem,4vw,6rem)] py-[clamp(2rem,3vw,4rem)]">
        <p className="text-[clamp(0.8rem,0.9vw,1.1rem)] tracking-kicker font-semibold uppercase mb-3" style={{ color: accentHex }}>
          Step 2 of 2
        </p>
        <h2 className="text-[clamp(1.8rem,3vw,3.8rem)] font-extrabold text-brand-ink mb-3 text-center text-pretty">
          Scan Your QR Code
        </h2>
        <p className="text-[clamp(0.9rem,1.1vw,1.3rem)] text-gray-500 mb-[clamp(1.5rem,2vw,2.5rem)] text-center max-w-3xl text-pretty">
          {subhead}
        </p>

        <div className="w-full max-w-xl mb-3">
          <div
            aria-live="polite"
            aria-label={`Reference code: ${value || 'empty'}`}
            className="flex items-center bg-white border-2 rounded-2xl px-[clamp(1rem,1.5vw,2rem)] py-[clamp(0.8rem,1.2vw,1.4rem)] text-[clamp(1.5rem,2.4vw,2.8rem)] font-mono tracking-widest min-h-[clamp(72px,7vw,108px)] transition-[border-color] duration-150"
            style={{ borderColor: value ? accentHex : '#e5e7eb' }}
          >
            <span className="flex-1 text-center text-brand-ink tabular-nums">
              {value || <span className="text-gray-300" translate="no">{placeholder}</span>}
            </span>
            {value && (
              <button
                type="button"
                onClick={() => setValue('')}
                className="text-gray-400 hover:text-brand-burgundy text-2xl ml-2 px-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-burgundy/40"
                aria-label="Clear reference code"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {!isFra && (
          <p className="text-[clamp(0.8rem,0.9vw,1.05rem)] text-gray-500 mb-[clamp(1.5rem,2vw,2.5rem)] text-center max-w-xl text-pretty">
            For Accreditation transaction, key in reference code{' '}
            <span className="font-mono text-brand-ink" translate="no">(XXXXX-XXXXXXXX)</span>
          </p>
        )}

        {loading ? (
          <div
            className="text-[clamp(1rem,1.3vw,1.5rem)] text-gray-500 motion-safe:animate-pulse py-12"
            role="status"
            aria-live="polite"
          >
            Searching&hellip;
          </div>
        ) : (
          <OnScreenKeyboard
            mode="alphanumeric"
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            accent={isFra ? 'burgundy' : 'navy'}
          />
        )}

        <button
          type="button"
          onClick={onBack}
          className="mt-[clamp(1.5rem,2vw,2.5rem)] px-10 py-3 text-[clamp(0.95rem,1vw,1.15rem)] font-medium text-gray-500 hover:text-brand-ink rounded-xl hover:bg-white transition-[color,background-color] duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-navy/20"
        >
          ← Back
        </button>
      </main>

      <div className="brand-strip" aria-hidden="true" />
    </div>
  );
}
