import { useState, useEffect } from 'react';
import { useMode } from '../contexts/ModeContext';
import * as nexusApi from '../services/nexus-api.client';
import { getSupabase, getSupabaseWriter } from '../services/supabase.client';

export function SettingsPage() {
  const { settings, updateSettings, toggleSettings } = useMode();
  const [printers, setPrinters] = useState<readonly PrinterInfo[]>([]);
  const [nexusStatus, setNexusStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [nexusError, setNexusError] = useState('');

  // Local form state
  const [supabaseUrl, setSupabaseUrl] = useState(settings?.supabaseUrl ?? '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(settings?.supabaseAnonKey ?? '');
  const [supabaseServiceKey, setSupabaseServiceKey] = useState(settings?.supabaseServiceKey ?? '');
  const [nexusApiUrl, setNexusApiUrl] = useState(settings?.nexusApiUrl ?? '');
  const [nexusUsername, setNexusUsername] = useState(settings?.nexusUsername ?? '');
  const [nexusPassword, setNexusPassword] = useState(settings?.nexusPassword ?? '');
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
      nexusApiUrl,
      nexusUsername,
      nexusPassword,
      printerName,
      paperWidth,
    });
    toggleSettings();
  }

  async function testNexusConnection() {
    setNexusStatus('testing');
    setNexusError('');
    try {
      nexusApi.configure(nexusApiUrl);
      await nexusApi.login(nexusUsername, nexusPassword);
      setNexusStatus('ok');
    } catch (err) {
      setNexusStatus('error');
      setNexusError(err instanceof Error ? err.message : 'Connection failed');
    }
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

    // Test 1: Can we reach the appointments table at all?
    try {
      const svc = getSupabaseWriter();
      const { data: countData, error: countErr } = await svc
        .from('appointments')
        .select('id', { count: 'exact', head: true });
      if (countErr) {
        lines.push(`[ANON SELECT] FAIL: ${countErr.message} (code: ${countErr.code})`);
      } else {
        lines.push(`[ANON SELECT] OK — table reachable`);
      }
    } catch (e) {
      lines.push(`[ANON SELECT] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 2: Same with service role
    try {
      const svc = getSupabaseWriter();
      const { data: countData2, error: countErr2 } = await svc
        .from('appointments')
        .select('id', { count: 'exact', head: true });
      if (countErr2) {
        lines.push(`[SERVICE SELECT] FAIL: ${countErr2.message}`);
      } else {
        lines.push(`[SERVICE SELECT] OK`);
      }
    } catch (e) {
      lines.push(`[SERVICE SELECT] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 3: Minimal query — just id and ref_code, no other columns
    try {
      const svc = getSupabaseWriter();
      const { data, error } = await svc
        .from('appointments')
        .select('id, ref_code')
        .eq('ref_code', 'CHDDY44V')
        .limit(1)
        .maybeSingle();
      if (error) {
        lines.push(`[REF LOOKUP minimal] FAIL: ${error.message} (code: ${error.code})`);
      } else if (!data) {
        lines.push(`[REF LOOKUP minimal] No row found for CHDDY44V`);
      } else {
        lines.push(`[REF LOOKUP minimal] FOUND: id=${(data as Record<string,unknown>).id}`);
      }
    } catch (e) {
      lines.push(`[REF LOOKUP minimal] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 4: Full field list from the service
    try {
      const svc = getSupabaseWriter();
      const { data, error } = await svc
        .from('appointments')
        .select(`id, ref_code, service_id, appointment_date, start_time, end_time,
          status, ofw_lname, ofw_fname, ofw_mname,
          client_email, client_contact, client_data, appt_status,
          p_name, ofw_visa, ofw_position, ofw_trans, ofw_gender,
          confirmed_at, staff_notes, created_at, updated_at`)
        .eq('ref_code', 'CHDDY44V')
        .limit(1)
        .maybeSingle();
      if (error) {
        lines.push(`[REF LOOKUP full] FAIL: ${error.message} (code: ${error.code}, details: ${error.details})`);
      } else if (!data) {
        lines.push(`[REF LOOKUP full] No row found`);
      } else {
        const d = data as Record<string,unknown>;
        lines.push(`[REF LOOKUP full] FOUND: status=${d.status}, date=${d.appointment_date}, name=${d.ofw_fname} ${d.ofw_lname}`);
      }
    } catch (e) {
      lines.push(`[REF LOOKUP full] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 5: List all column names by fetching one row with *
    try {
      const svc = getSupabaseWriter();
      const { data, error } = await svc
        .from('appointments')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) {
        lines.push(`[SELECT *] FAIL: ${error.message}`);
      } else if (data) {
        const cols = Object.keys(data as Record<string,unknown>).join(', ');
        lines.push(`[SELECT *] Columns: ${cols}`);
      } else {
        lines.push(`[SELECT *] Table is empty`);
      }
    } catch (e) {
      lines.push(`[SELECT *] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
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
              <label className="block text-sm font-medium text-gray-600 mb-1">Service Role Key (writes — walk-ins, check-ins)</label>
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

        {/* Nexus API */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Nexus API (Queue Push)
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">API URL</label>
              <input
                type="url"
                value={nexusApiUrl}
                onChange={(e) => setNexusApiUrl(e.target.value)}
                placeholder="https://nexus.yourdomain.com/api"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Username</label>
                <input
                  value={nexusUsername}
                  onChange={(e) => setNexusUsername(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Password</label>
                <input
                  type="password"
                  value={nexusPassword}
                  onChange={(e) => setNexusPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void testNexusConnection()}
                disabled={nexusStatus === 'testing'}
                className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                {nexusStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>
              {nexusStatus === 'ok' && (
                <span className="text-sm text-green-600 font-medium">Connected</span>
              )}
              {nexusStatus === 'error' && (
                <span className="text-sm text-red-500">{nexusError}</span>
              )}
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
            Test Supabase Query (CHDDY44V)
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
