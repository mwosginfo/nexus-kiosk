import { useState, useRef, useEffect } from 'react';
import { ScannerInput } from '../../components/ScannerInput';
import { DatePicker } from '../../components/DatePicker';
import { AppointmentCard } from '../../components/AppointmentCard';
import { FraCard } from '../../components/FraCard';
import { useScanner } from '../../hooks/useScanner';
import { todaySGT } from '../../lib/constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDay, faFileSignature, faSearch } from '@fortawesome/free-solid-svg-icons';
import * as appointmentService from '../../services/appointment.service';
import * as fraService from '../../services/fra.service';
import * as submissionService from '../../services/submission.service';
import type { AppointmentWithService } from '../../schemas/appointment.schema';
import type { FraRegistrationRow, FraGroup } from '../../schemas/fra.schema';
import type { SubmissionRow } from '../../schemas/submission.schema';

type SearchTab = 'search' | 'browse';
/** ALL = probe all three tables in parallel (kiosk-style unified router). */
type SearchScope = 'ALL' | 'REGULAR' | 'FRA' | 'ACCRE';
type BrowseMode = 'appointments' | 'fra';

interface SearchPanelProps {
  readonly onSelectAppointment: (appt: AppointmentWithService) => void;
  readonly onSelectFra: (fra: FraRegistrationRow) => void;
  readonly onSelectSubmission: (submission: SubmissionRow) => void;
  readonly selectedId: string | null;
}

export function SearchPanel({
  onSelectAppointment,
  onSelectFra,
  onSelectSubmission,
  selectedId,
}: SearchPanelProps) {
  const [tab, setTab] = useState<SearchTab>('search');
  const [scope, setScope] = useState<SearchScope>('ALL');
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appointments, setAppointments] = useState<readonly AppointmentWithService[]>([]);
  const [fraResults, setFraResults] = useState<readonly FraRegistrationRow[]>([]);
  const [submissionResults, setSubmissionResults] = useState<readonly SubmissionRow[]>([]);

  // Browse state (unchanged behavior)
  const [browseMode, setBrowseMode] = useState<BrowseMode>('appointments');
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseDate, setBrowseDate] = useState(todaySGT());
  const [browseAppointments, setBrowseAppointments] = useState<readonly AppointmentWithService[]>([]);
  const [browseFraResults, setBrowseFraResults] = useState<readonly FraGroup[]>([]);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Auto-load browse results when tab/mode/date changes
  useEffect(() => {
    if (tab === 'browse') {
      void doBrowse();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, browseDate, browseMode]);

  async function doBrowse() {
    setLoading(true);
    setError('');
    setBrowseAppointments([]);
    setBrowseFraResults([]);
    try {
      if (browseMode === 'fra') {
        const results = await fraService.browseFra(browseDate, browseSearch);
        setBrowseFraResults(results);
        if (results.length === 0) setError('No FRA registrations found');
      } else {
        const results = await appointmentService.browseAppointments(browseDate, browseSearch);
        setBrowseAppointments(results);
        if (results.length === 0) setError('No appointments found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browse failed');
    } finally {
      setLoading(false);
    }
  }

  async function doSearch(overrides?: { value?: string; forceScope?: SearchScope }) {
    const q = (overrides?.value ?? searchValue).trim();
    if (!q) return;

    const active = overrides?.forceScope ?? scopeRef.current;
    setLoading(true);
    setError('');
    setAppointments([]);
    setFraResults([]);
    setSubmissionResults([]);

    try {
      if (active === 'REGULAR') {
        const result = await appointmentService.lookupByRefCode(q);
        setAppointments(result ? [result] : []);
        if (!result) setError('No appointment found');
      } else if (active === 'FRA') {
        const result = await fraService.lookupByRef(q, { strict: false });
        setFraResults(result ? [result] : []);
        if (!result) setError('No FRA registration found');
      } else if (active === 'ACCRE') {
        const result = await submissionService.lookupByRefCode(q);
        setSubmissionResults(result ? [result] : []);
        if (!result) setError('No accreditation submission found');
      } else {
        // ALL — unified router. Probe all three in parallel; reject ambiguity.
        const [appt, fra, submission] = await Promise.all([
          appointmentService.lookupByRefCode(q),
          fraService.lookupByRef(q, { strict: false }),
          submissionService.lookupByRefCode(q),
        ]);
        const matchCount = (appt ? 1 : 0) + (fra ? 1 : 0) + (submission ? 1 : 0);

        if (matchCount === 0) {
          setError('No appointment, FRA registration, or accreditation submission found.');
        } else if (matchCount > 1) {
          setError('Ambiguous reference — narrow down with the radio above.');
        } else {
          if (appt) setAppointments([appt]);
          if (fra) setFraResults([fra]);
          if (submission) setSubmissionResults([submission]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  // QR scanner — feed the active scope. Default 'ALL' acts as the unified router.
  useScanner({
    onScan: (scanned) => {
      setSearchValue(scanned);
      setTab('search');
      void doSearch({ value: scanned });
    },
  });

  function switchTab(newTab: SearchTab) {
    setTab(newTab);
    setAppointments([]);
    setFraResults([]);
    setSubmissionResults([]);
    setBrowseAppointments([]);
    setBrowseFraResults([]);
    setError('');
  }

  const browseCount = browseMode === 'fra' ? browseFraResults.length : browseAppointments.length;

  return (
    <div className="p-4 space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => switchTab('search')}
          className={`flex-1 px-2 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 ${
            tab === 'search' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FontAwesomeIcon icon={faSearch} />
          Scan / Search
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

      {/* ─── Browse mode ─────────────────────────────────────────────── */}
      {tab === 'browse' && (
        <>
          <div className="flex gap-1 bg-gray-50 rounded-lg p-0.5">
            <button
              onClick={() => setBrowseMode('appointments')}
              className={`flex-1 px-3 py-1 text-xs rounded-md font-medium ${
                browseMode === 'appointments' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
              }`}
            >
              Appointments
            </button>
            <button
              onClick={() => setBrowseMode('fra')}
              className={`flex-1 px-3 py-1 text-xs rounded-md font-medium ${
                browseMode === 'fra' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
              }`}
            >
              FRA
            </button>
          </div>

          <div className="flex items-center gap-2">
            <DatePicker value={browseDate} onChange={setBrowseDate} />
          </div>
          <div className="flex gap-2">
            <input
              value={browseSearch}
              onChange={(e) => setBrowseSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doBrowse(); }}
              placeholder={browseMode === 'fra' ? 'Search FRA name or ref...' : 'Search name or email...'}
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
            {browseCount} {browseMode === 'fra' ? 'registration' : 'appointment'}{browseCount !== 1 ? 's' : ''} for {browseDate}
          </p>

          <div className="space-y-2">
            {browseMode === 'appointments' && browseAppointments.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                selected={selectedId === a.id}
                onClick={() => onSelectAppointment(a)}
              />
            ))}
            {browseMode === 'fra' && browseFraResults.map((g) => (
              <FraCard
                key={g.row.transaction_ref}
                fra={g.row}
                group={g}
                selected={selectedId === g.row.id}
                onClick={() => onSelectFra(g.row)}
              />
            ))}
          </div>
        </>
      )}

      {/* ─── Scan / Search mode ─────────────────────────────────────────── */}
      {tab === 'search' && (
        <>
          {/* Scope radio — ALL is the default unified router; the other three narrow the lookup to one table. */}
          <fieldset className="space-y-1">
            <legend className="text-xs uppercase tracking-wider text-gray-400 font-medium">Search in</legend>
            <div className="grid grid-cols-4 gap-1 bg-gray-100 rounded-lg p-1">
              <ScopeRadio label="All" value="ALL" current={scope} onChange={setScope} />
              <ScopeRadio label="Regular" value="REGULAR" current={scope} onChange={setScope} />
              <ScopeRadio label="FRA Reg" value="FRA" current={scope} onChange={setScope} />
              <ScopeRadio label="ACCRE" value="ACCRE" current={scope} onChange={setScope} />
            </div>
          </fieldset>

          <div className="flex gap-2">
            <ScannerInput
              value={searchValue}
              onChange={setSearchValue}
              onSubmit={() => void doSearch()}
              placeholder={scopePlaceholder(scope)}
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

          <div className="space-y-2">
            {appointments.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                selected={selectedId === a.id}
                onClick={() => onSelectAppointment(a)}
              />
            ))}
            {fraResults.map((f) => (
              <FraCard
                key={f.id}
                fra={f}
                selected={selectedId === f.id}
                onClick={() => onSelectFra(f)}
              />
            ))}
            {submissionResults.map((s) => (
              <SubmissionCardInline
                key={s.ref_code}
                submission={s}
                selected={selectedId === s.ref_code}
                onClick={() => onSelectSubmission(s)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Scope radio button ────────────────────────────────────────────────

interface ScopeRadioProps {
  readonly label: string;
  readonly value: SearchScope;
  readonly current: SearchScope;
  readonly onChange: (v: SearchScope) => void;
}

function ScopeRadio({ label, value, current, onChange }: ScopeRadioProps) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
        active ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

function scopePlaceholder(scope: SearchScope): string {
  switch (scope) {
    case 'REGULAR':
      return 'Scan or enter appointment ref code...';
    case 'FRA':
      return 'Scan or enter FRA transaction ref...';
    case 'ACCRE':
      return 'Scan or enter accreditation ref (XXXXX-XXXXXXXX)...';
    case 'ALL':
      return 'Scan or enter any reference (auto-detect)...';
  }
}

// ─── Inline submission card ────────────────────────────────────────────

interface SubmissionCardInlineProps {
  readonly submission: SubmissionRow;
  readonly selected: boolean;
  readonly onClick: () => void;
}

function SubmissionCardInline({ submission, selected, onClick }: SubmissionCardInlineProps) {
  const name = submissionService.resolveSubmissionName(submission) || 'Accreditation client';
  const status = submission.status ?? 'pending';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition-colors ${
        selected
          ? 'border-violet-400 bg-violet-50'
          : 'border-gray-200 bg-white hover:border-violet-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 h-9 w-9 flex items-center justify-center rounded-lg bg-violet-100 text-violet-600">
          <FontAwesomeIcon icon={faFileSignature} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
          <p className="text-xs text-gray-500 font-mono">{submission.ref_code}</p>
          <p className="text-[11px] text-gray-400 uppercase mt-1">
            Accreditation · {status}
            {submission.trans_status ? ` · ${submission.trans_status}` : ''}
          </p>
        </div>
      </div>
    </button>
  );
}
