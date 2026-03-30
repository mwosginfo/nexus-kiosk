import { useState, useEffect } from 'react';
import { useMode } from '../contexts/ModeContext';
import { getSupabaseWriter } from '../services/supabase.client';

export function SettingsPage() {
  const { settings, updateSettings, toggleSettings } = useMode();
  const [printers, setPrinters] = useState<readonly PrinterInfo[]>([]);

  // Local form state
  const [supabaseUrl, setSupabaseUrl] = useState(settings?.supabaseUrl ?? '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(settings?.supabaseAnonKey ?? '');
  const [supabaseServiceKey, setSupabaseServiceKey] = useState(settings?.supabaseServiceKey ?? '');
  const [printerName, setPrinterName] = useState(settings?.printerName ?? '');
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>(settings?.paperWidth ?? '80mm');

  useEffect(() => {
    void window.electronAPI.getPrinters().then(setPrinters);
  }, []);

  async function handleSave() {
    await updateSettings({
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceKey,
      printerName,
      paperWidth,
    });
    toggleSettings();
  }

  async function testPrint() {
    try {
      await window.electronAPI.printTicket({
        queueNumber: '0000',
        clientName: 'TEST PRINT',
        serviceType: 'TEST',
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Print failed');
    }
  }

  const [diagResult, setDiagResult] = useState('');

  async function runDiagnostic() {
    setDiagResult('Running...');
    const lines: string[] = [];

    // Test 1: appointments table reachable?
    try {
      const svc = getSupabaseWriter();
      const { error: countErr } = await svc
        .from('appointments')
        .select('id', { count: 'exact', head: true });
      if (countErr) {
        lines.push(`[APPOINTMENTS] FAIL: ${countErr.message} (code: ${countErr.code})`);
      } else {
        lines.push(`[APPOINTMENTS] OK — table reachable`);
      }
    } catch (e) {
      lines.push(`[APPOINTMENTS] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 2: transactions table reachable?
    try {
      const svc = getSupabaseWriter();
      const { error: txErr } = await svc
        .from('transactions')
        .select('id', { count: 'exact', head: true });
      if (txErr) {
        lines.push(`[TRANSACTIONS] FAIL: ${txErr.message} (code: ${txErr.code})`);
      } else {
        lines.push(`[TRANSACTIONS] OK — table reachable`);
      }
    } catch (e) {
      lines.push(`[TRANSACTIONS] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 3: sample appointment lookup
    try {
      const svc = getSupabaseWriter();
      const { data, error } = await svc
        .from('appointments')
        .select('id, ref_code, ofw_fname, ofw_lname, status, appointment_date')
        .limit(1)
        .maybeSingle();
      if (error) {
        lines.push(`[SAMPLE APPT] FAIL: ${error.message}`);
      } else if (data) {
        const d = data as Record<string, unknown>;
        lines.push(`[SAMPLE APPT] FOUND: ${d.ref_code} — ${d.ofw_fname} ${d.ofw_lname} (${d.status}, ${d.appointment_date})`);
      } else {
        lines.push(`[SAMPLE APPT] Table is empty`);
      }
    } catch (e) {
      lines.push(`[SAMPLE APPT] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 4: List printers
    try {
      const ps = await window.electronAPI.getPrinters();
      lines.push(`[PRINTERS] ${ps.length} found: ${ps.map((p) => `${p.name}${p.isDefault ? ' (default)' : ''}`).join(', ')}`);
    } catch (e) {
      lines.push(`[PRINTERS] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    setDiagResult(lines.join('\n'));
  }

  async function resetMode() {
    await updateSettings({ mode: null, rememberMode: false });
    window.location.reload();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800">Settings</h2>
          <button
            onClick={toggleSettings}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Supabase */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Supabase Connection
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Supabase URL</label>
              <input
                type="url"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Anon Key (reads)</label>
              <input
                type="password"
                value={supabaseAnonKey}
                onChange={(e) => setSupabaseAnonKey(e.target.value)}
                placeholder="eyJ..."
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Service Role Key (writes)</label>
              <input
                type="password"
                value={supabaseServiceKey}
                onChange={(e) => setSupabaseServiceKey(e.target.value)}
                placeholder="eyJ..."
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              />
            </div>
          </div>
        </section>

        {/* Printer */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Thermal Printer
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-600 mb-1">Printer</label>
              <select
                value={printerName}
                onChange={(e) => setPrinterName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="">System default</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.isDefault ? '(default)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Paper Width</label>
              <select
                value={paperWidth}
                onChange={(e) => setPaperWidth(e.target.value as '58mm' | '80mm')}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="58mm">58mm</option>
                <option value="80mm">80mm</option>
              </select>
            </div>
            <div className="pt-5">
              <button
                onClick={() => void testPrint()}
                className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg whitespace-nowrap"
              >
                Test Print
              </button>
            </div>
          </div>
        </section>

        {/* Diagnostic */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Diagnostic
          </h3>
          <button
            onClick={() => void runDiagnostic()}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Run Diagnostic
          </button>
          {diagResult && (
            <pre className="mt-3 p-3 bg-gray-900 text-green-400 text-xs rounded-lg overflow-x-auto whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
              {diagResult}
            </pre>
          )}
        </section>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <button
            onClick={() => void resetMode()}
            className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
          >
            Reset to Mode Selection
          </button>
          <div className="flex gap-3">
            <button
              onClick={toggleSettings}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              className="px-6 py-2 text-sm text-white bg-teal-500 hover:bg-teal-600 rounded-lg"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
