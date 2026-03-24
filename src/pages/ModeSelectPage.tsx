import { useState } from 'react';
import { useMode } from '../contexts/ModeContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDesktop, faTabletScreenButton } from '@fortawesome/free-solid-svg-icons';
import mwoLogo from '../assets/mwo_logo.png';

export function ModeSelectPage() {
  const { setMode } = useMode();
  const [remember, setRemember] = useState(false);

  async function selectMode(mode: 'RECEPTIONIST' | 'KIOSK') {
    await setMode(mode, remember);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
      <div className="text-center space-y-10">
        <div>
          <img src={mwoLogo} alt="MWO Logo" className="w-20 h-20 mx-auto mb-4 object-contain" />
          <h1 className="text-4xl font-bold text-white mb-2">Nexus Kiosk</h1>
          <p className="text-slate-400 text-lg">Migrant Workers Office — Check-in System</p>
        </div>

        <div className="flex gap-8">
          {/* Receptionist Card */}
          <button
            onClick={() => void selectMode('RECEPTIONIST')}
            className="group w-72 bg-slate-700/50 hover:bg-slate-700 border-2 border-slate-600 hover:border-teal-500 rounded-2xl p-8 transition-all duration-200"
          >
            <div className="flex justify-center mb-4">
              <FontAwesomeIcon icon={faDesktop} className="text-teal-400 group-hover:text-teal-300" style={{ fontSize: '4rem' }} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Receptionist</h2>
            <p className="text-slate-400 text-sm">
              Full search, walk-in registration, and appointment management
            </p>
          </button>

          {/* Kiosk Card */}
          <button
            onClick={() => void selectMode('KIOSK')}
            className="group w-72 bg-slate-700/50 hover:bg-slate-700 border-2 border-slate-600 hover:border-blue-500 rounded-2xl p-8 transition-all duration-200"
          >
            <div className="flex justify-center mb-4">
              <FontAwesomeIcon icon={faTabletScreenButton} className="text-blue-400 group-hover:text-blue-300" style={{ fontSize: '4rem' }} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Kiosk</h2>
            <p className="text-slate-400 text-sm">
              Self-service check-in with QR scanning and touch interface
            </p>
          </button>
        </div>

        {/* Remember checkbox */}
        <label className="flex items-center justify-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-5 h-5 rounded border-slate-500 text-teal-500 focus:ring-teal-500 bg-slate-700"
          />
          <span className="text-slate-300 text-sm">Don't ask me again</span>
        </label>

        <p className="text-slate-500 text-xs">
          Press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300 font-mono text-xs">Ctrl+Shift+S</kbd> anytime to open settings
        </p>
      </div>
    </div>
  );
}
