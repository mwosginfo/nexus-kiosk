import mwoLogo from '../../assets/mwo_logo.png';

interface SplashScreenProps {
  readonly onStart: () => void;
}

export function SplashScreen({ onStart }: SplashScreenProps) {
  return (
    <button
      onClick={onStart}
      className="kiosk-mode w-full min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-white"
    >
      <div className="text-center space-y-8">
        <img src={mwoLogo} alt="MWO Logo" className="w-32 h-32 mx-auto object-contain" />

        <div>
          <h1 className="text-5xl font-bold mb-3">Migrant Workers Office</h1>
          <p className="text-2xl text-slate-300">Singapore</p>
        </div>

        <div className="animate-pulse">
          <p className="text-3xl font-light text-teal-400">Touch to Start</p>
        </div>

        <p className="text-sm text-slate-500">Check-in Kiosk</p>
      </div>
    </button>
  );
}
