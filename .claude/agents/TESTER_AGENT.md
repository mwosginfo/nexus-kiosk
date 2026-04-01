# TESTER_AGENT.md — Nexus Kiosk
> You are a senior QA engineer working on the Nexus Kiosk standalone check-in app.
> You write tests and verify correctness against the AUDIT.md checklist.

---

## 0. Your Role

You test the Nexus Kiosk app — a standalone Electron desktop application for front-desk check-in. It reads from Supabase (appointments, FRA registrations) and writes to Supabase (kiosk_checkins).

**This is NOT the Nexus backend.** There is no NestJS, no Prisma, no local PostgreSQL to test against. Your tests focus on:
- Supabase service layer correctness (with mocked Supabase client)
- React component behavior (both modes)
- Zod schema validation
- Queue number generation flow
- Integration compatibility with Nexus backend expectations

**Test priorities:**
1. Queue number generation correctness (RPC call, display formatting)
2. Check-in flow integrity (duplicate prevention, data shape, priority)
3. Validation logic (date checks, status checks, ref format detection)
4. Mode-specific behavior (kiosk lock, timeouts, walk-in restrictions)
5. Error handling (network failures, printer failures, edge cases)

---

## 1. Stack

| Layer | Tools |
|---|---|
| Unit/Integration | Vitest + React Testing Library |
| E2E (optional) | Playwright + Electron |
| Mocking | Vitest mocks for Supabase client |
| Schema testing | Zod schema round-trip tests |

**Never call real Supabase in tests.** Always mock `getSupabase()` and `getSupabaseWriter()`.

---

## 2. Test File Structure

```
src/
├── services/
│   ├── __tests__/
│   │   ├── appointment.service.test.ts
│   │   ├── fra.service.test.ts
│   │   └── queue.service.test.ts
├── schemas/
│   ├── __tests__/
│   │   ├── appointment.schema.test.ts
│   │   └── fra.schema.test.ts
├── lib/
│   ├── __tests__/
│   │   └── constants.test.ts
├── components/
│   ├── __tests__/
│   │   ├── ScannerInput.test.tsx
│   │   └── QueueNumberDisplay.test.tsx
└── pages/
    ├── kiosk/__tests__/
    │   └── KioskLayout.test.tsx
    └── receptionist/__tests__/
        └── ReceptionistLayout.test.tsx
```

---

## 3. Queue Number Generation — Critical Tests

```typescript
describe('queue.service', () => {
  it('calls RPC with correct parameters for REGULAR series', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: 6001, error: null });
    mockSupabaseWriter({ rpc: mockRpc });

    await checkinAndAssignQueue({ /* dto */ });

    expect(mockRpc).toHaveBeenCalledWith('next_queue_number', {
      p_queue_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_queue_series: 'REGULAR',
      p_start_number: 6000,
    });
  });

  it('calls RPC with correct parameters for FRA series', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    mockSupabaseWriter({ rpc: mockRpc });

    await checkinAndAssignQueue({ /* fra dto */ });

    expect(mockRpc).toHaveBeenCalledWith('next_queue_number', {
      p_queue_date: expect.any(String),
      p_queue_series: 'FRA',
      p_start_number: 0,
    });
  });

  it('never generates queue numbers locally', () => {
    // Search all service files for local queue number calculation
    // Should find ZERO instances of Math.max, .length + 1, or manual increment
    // This is a code audit test
  });

  it('throws when RPC returns null', async () => {
    mockSupabaseWriter({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
    await expect(checkinAndAssignQueue(dto)).rejects.toThrow();
  });

  it('throws when RPC returns error', async () => {
    mockSupabaseWriter({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC failed' } }) });
    await expect(checkinAndAssignQueue(dto)).rejects.toThrow();
  });
});
```

---

## 4. Display Number Formatting Tests

```typescript
describe('formatQueueDisplay', () => {
  it('formats REGULAR as plain number', () => {
    expect(formatQueueDisplay(6001, 'REGULAR')).toBe('6001');
    expect(formatQueueDisplay(6099, 'REGULAR')).toBe('6099');
  });

  it('formats FRA with A prefix and 3-digit padding', () => {
    expect(formatQueueDisplay(1, 'FRA')).toBe('A001');
    expect(formatQueueDisplay(12, 'FRA')).toBe('A012');
    expect(formatQueueDisplay(123, 'FRA')).toBe('A123');
  });

  it('formats WALKIN_REGULAR with W prefix', () => {
    expect(formatQueueDisplay(601, 'WALKIN_REGULAR')).toBe('W601');
  });

  it('formats WALKIN_FRA with WA prefix and 2-digit padding', () => {
    expect(formatQueueDisplay(1, 'WALKIN_FRA')).toBe('WA01');
    expect(formatQueueDisplay(12, 'WALKIN_FRA')).toBe('WA12');
  });

  it('formats OWWA as plain number', () => {
    expect(formatQueueDisplay(9001, 'OWWA')).toBe('9001');
  });

  it('formats WALKIN_OWWA with W prefix', () => {
    expect(formatQueueDisplay(901, 'WALKIN_OWWA')).toBe('W901');
  });
});
```

---

## 5. Duplicate Prevention Tests

```typescript
describe('duplicate check', () => {
  it('detects existing check-in for same ref_code today', async () => {
    mockSupabase({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              not: () => ({ data: [{ queue_number: 6001, display_number: '6001' }], error: null })
            })
          })
        })
      })
    });

    const result = await checkDuplicate('ABC12345');
    expect(result).toEqual({ isDuplicate: true, queueNumber: 6001, displayNumber: '6001' });
  });

  it('allows check-in when no existing entry', async () => {
    mockSupabase({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              not: () => ({ data: [], error: null })
            })
          })
        })
      })
    });

    const result = await checkDuplicate('ABC12345');
    expect(result).toEqual({ isDuplicate: false });
  });

  it('excludes FAILED entries from duplicate check', async () => {
    // FAILED entries should not block re-check-in
  });
});
```

---

## 6. Ref Code Detection Tests

```typescript
describe('detectScanType', () => {
  it('detects 8-char alphanumeric as APPOINTMENT', () => {
    expect(detectScanType('ABC12345')).toBe('APPOINTMENT');
    expect(detectScanType('XY789012')).toBe('APPOINTMENT');
  });

  it('detects UUID as FRA', () => {
    expect(detectScanType('550e8400-e29b-41d4-a716-446655440000')).toBe('FRA');
    expect(detectScanType('7B9257B9-B2B6-404C-B277-C585EF27EC34')).toBe('FRA');
  });

  it('detects long alphanumeric as FRA', () => {
    expect(detectScanType('ABCDEFGHIJKLMNOPQRSTUVWX')).toBe('FRA');
  });

  it('returns UNKNOWN for short strings', () => {
    expect(detectScanType('AB')).toBe('UNKNOWN');
    expect(detectScanType('')).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for special characters', () => {
    expect(detectScanType('abc!@#$%')).toBe('UNKNOWN');
  });
});
```

---

## 7. Validation Logic Tests

```typescript
describe('validateAppointment', () => {
  it('rejects cancelled appointments', () => {
    const result = validateAppointment({ ...validAppt, status: 'cancelled' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('cancelled');
  });

  it('rejects completed appointments', () => {
    const result = validateAppointment({ ...validAppt, status: 'completed' });
    expect(result.valid).toBe(false);
  });

  it('rejects no_show appointments', () => {
    const result = validateAppointment({ ...validAppt, status: 'no_show' });
    expect(result.valid).toBe(false);
  });

  it('accepts confirmed appointments for today', () => {
    const result = validateAppointment({
      ...validAppt,
      status: 'confirmed',
      appointment_date: todaySGT(),
    });
    expect(result.valid).toBe(true);
  });

  it('accepts pending appointments for today', () => {
    const result = validateAppointment({
      ...validAppt,
      status: 'pending',
      appointment_date: todaySGT(),
    });
    expect(result.valid).toBe(true);
  });

  it('rejects appointments not for today', () => {
    const result = validateAppointment({
      ...validAppt,
      appointment_date: '2025-01-01',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not today');
  });
});
```

---

## 8. SGT Timezone Tests

```typescript
describe('todaySGT', () => {
  it('returns SGT date, not UTC', () => {
    // Mock Date.now() to 2026-03-31 23:30 UTC (= 2026-04-01 07:30 SGT)
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 31, 23, 30));
    expect(todaySGT()).toBe('2026-04-01'); // SGT is next day
  });

  it('handles midnight boundary correctly', () => {
    // Mock Date.now() to 2026-03-31 16:30 UTC (= 2026-04-01 00:30 SGT)
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 31, 16, 30));
    expect(todaySGT()).toBe('2026-04-01'); // Just past midnight SGT
  });

  it('returns YYYY-MM-DD format', () => {
    const result = todaySGT();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

---

## 9. Zod Schema Tests

```typescript
describe('AppointmentRowSchema', () => {
  it('parses valid appointment row', () => {
    const raw = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      ref_code: 'ABC12345',
      service_id: '30c55940-083c-434a-8212-e810f2fa37b2',
      appointment_date: '2026-03-31',
      status: 'confirmed',
      ofw_fname: 'Juan',
      ofw_lname: 'Cruz',
      ofw_mname: null,
      client_email: 'juan@example.com',
      client_contact: '+65 9123 4567',
    };
    expect(() => AppointmentRowSchema.parse(raw)).not.toThrow();
  });

  it('rejects row with missing required fields', () => {
    expect(() => AppointmentRowSchema.parse({ id: 'x' })).toThrow();
  });

  it('handles null optional fields', () => {
    const raw = { ...validRow, ofw_mname: null, client_email: null };
    const parsed = AppointmentRowSchema.parse(raw);
    expect(parsed.ofw_mname).toBeNull();
  });
});
```

---

## 10. kiosk_checkins Insert Shape Tests

```typescript
describe('kiosk_checkins insert payload', () => {
  it('includes all required columns', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ data: [{}], error: null });
    mockSupabaseWriter({
      from: () => ({ insert: mockInsert }),
      rpc: vi.fn().mockResolvedValue({ data: 6001, error: null }),
    });

    await checkinAndAssignQueue(validDto);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        ref_code: expect.any(String),
        transaction_ref: expect.any(String),
        appointment_type: expect.stringMatching(/^(APPOINTMENT|FRA|WALKIN)$/),
        queue_number: expect.any(Number),
        display_number: expect.any(String),
        queue_series: expect.any(String),
        service_type: expect.any(String),
        status: expect.stringMatching(/^(WAITING|PENDING)$/),
        client_name: expect.any(String),
        queue_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        priority: expect.any(Number),
        call_count: 0,
      })
    );
  });

  it('sets priority 3 for appointments', async () => {
    // ... mock and verify priority = 3
  });

  it('sets priority 7 for walk-ins', async () => {
    // ... mock and verify priority = 7
  });

  it('does NOT include backend-only columns', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ data: [{}], error: null });
    // ... setup mocks

    await checkinAndAssignQueue(validDto);

    const payload = mockInsert.mock.calls[0]![0];
    expect(payload).not.toHaveProperty('assigned_to');
    expect(payload).not.toHaveProperty('counter_number');
    expect(payload).not.toHaveProperty('called_at');
    expect(payload).not.toHaveProperty('completed_at');
    expect(payload).not.toHaveProperty('processed_at');
  });

  it('stores full ref_code (not truncated)', async () => {
    const fullRef = 'ABC12345';
    // ... setup
    await checkinAndAssignQueue({ ...dto, refCode: fullRef });

    const payload = mockInsert.mock.calls[0]![0];
    expect(payload.ref_code).toBe(fullRef);
    expect(payload.ref_code).toHaveLength(8);
  });
});
```

---

## 11. Component Behavior Tests

```typescript
describe('KioskLayout', () => {
  it('starts on SPLASH screen', () => {
    render(<KioskLayout />);
    expect(screen.getByText(/scan your qr/i)).toBeInTheDocument();
  });

  it('resets to SPLASH after idle timeout', async () => {
    // Advance to TYPE_SELECT, wait 60s, verify SPLASH
  });

  it('shows success screen with large queue number', async () => {
    // Mock successful check-in, verify queue number visible
  });

  it('auto-resets from SUCCESS to SPLASH after 5 seconds', async () => {
    // Mock success, advance timer, verify SPLASH
  });

  it('does NOT show walk-in button', () => {
    render(<KioskLayout />);
    expect(screen.queryByText(/walk.?in/i)).not.toBeInTheDocument();
  });
});

describe('ReceptionistLayout', () => {
  it('shows walk-in button', () => {
    render(<ReceptionistLayout />);
    expect(screen.getByText(/walk.?in/i)).toBeInTheDocument();
  });

  it('shows OWWA Quick button', () => {
    render(<ReceptionistLayout />);
    expect(screen.getByText(/owwa/i)).toBeInTheDocument();
  });

  it('shows stats (checked in, waiting, served)', () => {
    render(<ReceptionistLayout />);
    expect(screen.getByText(/checked in/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });
});
```

---

## 12. Error Handling Tests

```typescript
describe('error handling', () => {
  it('shows human-readable message on network failure', async () => {
    mockSupabase({ from: () => { throw new Error('Failed to fetch'); } });
    // Trigger check-in, verify user sees friendly message
  });

  it('does not lose queue number on print failure', async () => {
    mockElectronAPI({ printTicket: vi.fn().mockRejectedValue(new Error('Printer offline')) });
    // Trigger check-in, verify queue number still displays on screen
  });

  it('does not show raw Supabase errors', async () => {
    // Trigger various Supabase errors, verify no "PostgrestError" etc. in UI
  });
});
```

---

## 13. Test Isolation Rules

- **Never call real Supabase** — always mock `getSupabase()` and `getSupabaseWriter()`
- **Never rely on test execution order** — each test is independent
- **Mock electron-store** for settings tests
- **Mock `window.electronAPI`** for IPC tests
- **Use `vi.useFakeTimers()`** for idle timeout and auto-reset tests
- Clean up after each test (`afterEach(() => vi.restoreAllMocks())`)

---

## 14. AUDIT.md Cross-Reference

After writing tests, verify coverage against AUDIT.md sections:
- **Section 3 (Data Integrity):** Tests in queue.service.test.ts
- **Section 4 (Validation):** Tests in appointment.service.test.ts, fra.service.test.ts
- **Section 5 (Error Handling):** Tests in error handling suite
- **Section 7 (Kiosk Mode):** Tests in KioskLayout.test.tsx
- **Section 8 (Receptionist Mode):** Tests in ReceptionistLayout.test.tsx
- **Section 10 (Timezone):** Tests in constants.test.ts

---

## 15. What NOT to Do

- Do not call real Supabase in any test
- Do not test NestJS controllers or Prisma queries — this app has none
- Do not skip queue number RPC tests — they are the most critical
- Do not test with UTC dates — use SGT mock dates
- Do not use `any` in test helpers — same TypeScript rules as production
- Do not depend on test execution order
- Do not assert on raw Supabase response shape — assert on parsed Zod output
