import { useState, useRef, useEffect } from 'react';
import { ScannerInput } from '../../components/ScannerInput';
import { DatePicker } from '../../components/DatePicker';
import { AppointmentCard } from '../../components/AppointmentCard';
import { FraCard } from '../../components/FraCard';
import { useScanner } from '../../hooks/useScanner';
import { todaySGT, detectScanType } from '../../lib/constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers, faBuilding, faCalendarDay } from '@fortawesome/free-solid-svg-icons';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow } from '../../schemas/fra.schema';

type SearchTab = 'regular' | 'fra' | 'browse';
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

  // Browse state
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseDate, setBrowseDate] = useState(todaySGT());
  const [browseResults, setBrowseResults] = useState<readonly AppointmentWithService[]>([]);

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const dateRef = useRef(date);
  dateRef.current = date;

  // Auto-load browse results when tab switches or date changes
  useEffect(() => {
    if (tab === 'browse') {
      void doBrowse();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, browseDate]);

  async function doBrowse() {
    setLoading(true);
    setError('');
    try {
      const results = await appointmentService.browseAppointments(browseDate, browseSearch);
      setBrowseResults(results);
      if (results.length === 0) setError('No appointments found');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browse failed');
    } finally {
      setLoading(false);
    }
  }

  async function doSearch(overrides?: {
    value?: string;
    forceTab?: SearchTab;
  }) {
    const q = (overrides?.value ?? searchValue).trim();
    if (!q) return;

    const activeTab = overrides?.forceTab ?? tabRef.current;
    if (activeTab === 'browse') return; // browse uses doBrowse

    setLoading(true);
    setError('');
    setAppointments([]);
    setFraResults([]);

    try {
      if (activeTab === 'fra') {
        const result = await fraService.lookupByRef(q);
        setFraResults(result ? [result] : []);
        if (!result) setError('No FRA registration found');
      } else if (searchMode === 'ref_code') {
        const result = await appointmentService.lookupByRefCode(q);
        setAppointments(result ? [result] : []);
        if (!result) setError('No appointment found');
      } else {
        const results = await appointmentService.lookupByPhone(q, dateRef.current);
        setAppointments(results);
        if (results.length === 0) setError('No appointments found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  // QR scanner — auto-detect FRA (UUID or long alphanumeric) vs regular appointment
  useScanner({
    onScan: (scanned) => {
      const scanType = detectScanType(scanned);
      const forceTab: SearchTab = scanType === 'FRA' ? 'fra' : 'regular';
      setSearchValue(scanned);
      setTab(forceTab);
      setSearchMode('ref_code');
      void doSearch({ value: scanned, forceTab });
    },
  });

  function switchTab(newTab: SearchTab) {
    setTab(newTab);
    setAppointments([]);
    setFraResults([]);
    setBrowseResults([]);
    setError('');
  }

  return (
    <div className="p-4 space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => switchTab('regular')}
          className={`flex-1 px-2 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'regular' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FontAwesomeIcon icon={faUsers} />
          Scan / Search
        </button>
        <button
          onClick={() => switchTab('fra')}
          className={`flex-1 px-2 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'fra' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FontAwesomeIcon icon={faBuilding} />
          FRA
        </button>
        <button
          onClick={() => switchTab('browse')}
          className={`flex-1 px-2 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'browse' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FontAwesomeIcon icon={faCalendarDay} />
          Browse
        </button>
      </div>

      {/* ─── Browse mode ───────────────────────────────────────────────── */}
      {tab === 'browse' && (
        <>
          <div className="flex items-center gap-2">
            <DatePicker value={browseDate} onChange={setBrowseDate} />
          </div>
          <div className="flex gap-2">
            <input
              value={browseSearch}
              onChange={(e) => setBrowseSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doBrowse(); }}
              placeholder="Search name or email..."
              className="flex-1 px-3 py-2 border rounded-lg text-sm border-gray-200 focus:border-teal-500 focus:ring-teal-400/30 focus:outline-none focus:ring-2"
            />
            <button
              onClick={() => void doBrowse()}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? '...' : 'Search'}
            </button>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <p className="text-xs text-gray-400">
            {browseResults.length} appointment{browseResults.length !== 1 ? 's' : ''} for {browseDate}
          </p>

          <div className="space-y-2">
            {browseResults.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                selected={selectedId === a.id}
                onClick={() => onSelectAppointment(a)}
              />
            ))}
          </div>
        </>
      )}

      {/* ─── Scan / Search mode ────────────────────────────────────────── */}
      {tab !== 'browse' && (
        <>
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
                  ? 'Scan or enter transaction ref...'
                  : searchMode === 'phone'
                    ? 'Enter phone number...'
                    : 'Scan or enter ref code...'
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

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

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
        </>
      )}
    </div>
  );
}
