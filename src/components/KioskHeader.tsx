import mwoLogo from '../assets/mwologo.png';
import owwaLogo from '../assets/owwalogo.png';

interface KioskHeaderProps {
  /** Optional small kicker shown below the logos (e.g. "OFW / Employer") */
  readonly kicker?: string;
}

export function KioskHeader({ kicker }: KioskHeaderProps) {
  return (
    <header className="w-full border-b border-gray-200/80 bg-white/95 backdrop-blur">
      <div className="flex flex-col items-center justify-center px-[clamp(2rem,4vw,5rem)] py-[clamp(1rem,1.4vw,2rem)]">
        <div className="flex items-center justify-center gap-[clamp(1.5rem,3vw,4rem)]">
          <img
            src={mwoLogo}
            alt="Migrant Workers Office Singapore"
            width={400}
            height={400}
            className="h-[clamp(64px,5vw,120px)] w-auto select-none"
            draggable={false}
            fetchPriority="high"
          />
          <img
            src={owwaLogo}
            alt="Overseas Workers Welfare Administration"
            width={400}
            height={400}
            className="h-[clamp(64px,5vw,120px)] w-auto select-none"
            draggable={false}
            fetchPriority="high"
          />
        </div>
        {kicker && (
          <p className="mt-3 text-[clamp(0.7rem,0.75vw,0.9rem)] tracking-kicker font-semibold text-brand-burgundy uppercase">
            {kicker}
          </p>
        )}
      </div>
    </header>
  );
}
