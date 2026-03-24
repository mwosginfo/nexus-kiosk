import { useState, useRef } from 'react';
import { ScannerInput } from '../../components/ScannerInput';
import { DatePicker } from '../../components/DatePicker';
import { AppointmentCard } from '../../components/AppointmentCard';
import { FraCard } from '../../components/FraCard';
import { useScanner } from '../../hooks/useScanner';
import { todaySGT, UUID_REGEX } from '../../lib/constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers, faBuilding } from '@fortawesome/free-solid-svg-icons';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';

type SearchTab = 'regular' | 'fra';
type SearchMode = 'ref_code' | 'phone';

interface SearchPanelProps {
  readonly onSelectAppointment: (appt: AppointmentWithService) => void;
  readonly onSelectFra: (fra: FraRegistrationRow) => void;
  readonly selectedId: string | null;
}

export function SearchPanel({ onSelectAppointment, onSelectFra, selectedId }: SearchPanelProps) {
  const [tab, setTab] = useState<SearchTab>('regular');
  const [searchMode, setSearchMode] = useState<SearchMode>('ref_code');
  const [searchValue, setSearchValue] = useState('');
  const [date, setDate] = useState(todaySGT());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appointments, setAppointments] = useState<readonly AppointmentWithService[]>([]);
  const [fraResults, setFraResults] = useState<readonly FraRegistrationRow[]>([]);

  // Refs to avoid stale closures in scanner callback
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const dateRef = useRef(date);
  dateRef.current = date;

  /**
   * Main search — takes explicit params to avoid stale closure issues.
   * For ref_code: NO date filter (ref_code is unique).
   * For phone: date filter applies.
   */
  async function doSearch(overrides?: {
    value?: string;
    forceTab?: SearchTab;
  }) {
    const q = (overrides?.value ?? searchValue).trim();
    if (!q) return;

    const activeTab = overrides?.forceTab ?? tabRef.current;

    setLoading(true);
    setError('');
    setAppointments([]);
    setFraResults([]);

    try {
      if (activeTab === 'fra') {
        // FRA: transaction_ref only, NO date filter
        const result = await fraService.lookupByRef(q);
        setFraResults(result ? [result] : []);
        if (!result) setError('No FRA registration found');
      } else if (searchMode === 'ref_code') {
        // Regular: ref_code only, NO date filter
        const result = await appointmentService.lookupByRefCode(q);
        setAppointments(result ? [result] : []);
        if (!result) setError('No appointment found');
      } else {
        // Phone: date filter applies
        const results = await appointmentService.lookupByPhone(q, dateRef.current);
        setAppointments(results);
        if (results.length === 0) setError('No appointments found');
      }
    } catch (err) {
      console.error('[SearchPanel] Search error:', err);
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  // QR scanner — auto-detect FRA (UUID) vs regular, search immediately
  useScanner({
    onScan: (scanned) => {
      const isFra = UUID_REGEX.test(scanned);
      const forceTab: SearchTab = isFra ? 'fra' : 'regular';

      setSearchValue(scanned);
      setTab(forceTab);
      setSearchMode('ref_code');

      // Pass forceTab explicitly to avoid stale closure
      void doSearch({ value: scanned, forceTab });
    },
  });

  return (
    <div className="p-4 space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => { setTab('regular'); setAppointments([]); setFraResults([]); setError(''); }}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'regular' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FontAwesomeIcon icon={faUsers} />
          Regular / OWWA
        </button>
        <button
          onClick={() => { setTab('fra'); setSearchMode('ref_code'); setAppointments([]); setFraResults([]); setError(''); }}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'fra' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FontAwesomeIcon icon={faBuilding} />
          FRA
        </button>
      </div>

      {/* Search mode + date */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setSearchMode('ref_code')}
            className={`px-3 py-1 text-xs rounded-md font-medium ${
              searchMode === 'ref_code' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
            }`}
          >
            {tab === 'fra' ? 'Transaction Ref' : 'Ref Code'}
          </button>
          {tab !== 'fra' && (
            <button
              onClick={() => setSearchMode('phone')}
              className={`px-3 py-1 text-xs rounded-md font-medium ${
                searchMode === 'phone' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
              }`}
            >
              Phone
            </button>
          )}
        </div>
        {/* Date picker only relevant for phone search */}
        {searchMode === 'phone' && <DatePicker value={date} onChange={setDate} />}
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <ScannerInput
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={() => void doSearch()}
          placeholder={
            tab === 'fra'
              ? 'Enter transaction ref...'
              : searchMode === 'phone'
                ? 'Enter phone number...'
                : 'Enter ref code...'
          }
          className="border-gray-200 focus:border-teal-500 focus:ring-teal-400/30"
        />
        <button
          onClick={() => void doSearch()}
          disabled={loading || !searchValue.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Results */}
      <div className="space-y-2">
        {tab === 'regular' && appointments.map((a) => (
          <AppointmentCard
            key={a.id}
            appointment={a}
            selected={selectedId === a.id}
            onClick={() => onSelectAppointment(a)}
          />
        ))}
        {tab === 'fra' && fraResults.map((f) => (
          <FraCard
            key={f.id}
            fra={f}
            selected={selectedId === f.id}
            onClick={() => onSelectFra(f)}
          />
        ))}
      </div>
    </div>
  );
}
