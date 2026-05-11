import mwoLogo from '../../assets/mwologo.png';
import owwaLogo from '../../assets/owwalogo.png';

interface SplashScreenProps {
  readonly onStart: () => void;
}

export function SplashScreen({ onStart }: SplashScreenProps) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="kiosk-mode w-full min-h-screen flex flex-col bg-brand-paper focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-navy/30"
    >
      <div className="flex-1 flex flex-col items-center justify-center px-12">
        <div className="flex items-center justify-center gap-[clamp(2rem,5vw,6rem)] mb-[clamp(2rem,3vw,4rem)]">
          <img
            src={mwoLogo}
            alt="Migrant Workers Office Singapore"
            width={400}
            height={400}
            className="h-[clamp(140px,14vw,260px)] w-auto"
            draggable={false}
            fetchPriority="high"
          />
          <img
            src={owwaLogo}
            alt="Overseas Workers Welfare Administration"
            width={400}
            height={400}
            className="h-[clamp(140px,14vw,260px)] w-auto"
            draggable={false}
            fetchPriority="high"
          />
        </div>

        <p className="text-[clamp(0.85rem,1vw,1.2rem)] tracking-kicker font-semibold text-brand-navy uppercase mb-3">
          Migrant Workers Office &middot; Singapore
        </p>
        <h1 className="text-[clamp(2.5rem,5vw,5.5rem)] font-extrabold text-brand-ink leading-tight text-center text-pretty">
          Welcome
        </h1>
        <p className="mt-4 text-[clamp(1rem,1.3vw,1.5rem)] text-gray-600 text-center max-w-2xl text-pretty">
          Self-service check-in for your appointment, FRA registration, or pickup.
        </p>

        <div className="mt-[clamp(2.5rem,4vw,5rem)] inline-flex items-center gap-3 px-[clamp(2rem,3vw,3.5rem)] py-[clamp(1rem,1.3vw,1.4rem)] rounded-full bg-brand-navy text-white shadow-lg shadow-brand-navy/20 motion-safe:animate-pulse">
          <span className="text-[clamp(1.1rem,1.4vw,1.6rem)] font-semibold tracking-wide">
            Touch Anywhere to Start
          </span>
        </div>
      </div>

      <div className="brand-strip" aria-hidden="true" />
    </button>
  );
}
