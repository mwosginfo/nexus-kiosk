import { ModeProvider, useMode } from './contexts/ModeContext';
import { ModeSelectPage } from './pages/ModeSelectPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReceptionistLayout } from './pages/receptionist/ReceptionistLayout';
import { KioskLayout } from './pages/kiosk/KioskLayout';

function AppContent() {
  const { mode, loading, settingsOpen } = useMode();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <p className="text-slate-400 text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <>
      {/* Settings overlay */}
      {settingsOpen && <SettingsPage />}

      {/* Mode-based rendering */}
      {mode === 'RECEPTIONIST' ? (
        <ReceptionistLayout />
      ) : mode === 'KIOSK' ? (
        <KioskLayout />
      ) : (
        <ModeSelectPage />
      )}
    </>
  );
}

export function App() {
  return (
    <ModeProvider>
      <AppContent />
    </ModeProvider>
  );
}
