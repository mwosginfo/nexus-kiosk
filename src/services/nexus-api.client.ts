import { z } from 'zod';

/** Nexus queue entry shape (subset needed by kiosk) */
const QueueEntrySchema = z.object({
  id: z.string(),
  queueNumber: z.number(),
  clientName: z.string(),
  serviceType: z.string(),
  queueSeries: z.string(),
  status: z.string(),
});

/** Nexus checkin response */
const CheckinResponseSchema = z.object({
  entry: QueueEntrySchema,
  queueSeries: z.string(),
});

/** Nexus FRA checkin response */
const FraCheckinResponseSchema = z.object({
  queueNumber: z.number(),
  displayNumber: z.string(),
  fra: z.string(),
  alreadyCheckedIn: z.boolean().optional(),
});

/** Nexus walk-in response */
const WalkInResponseSchema = z.object({
  entry: QueueEntrySchema,
});

export type QueueEntry = z.infer<typeof QueueEntrySchema>;
export type CheckinResponse = z.infer<typeof CheckinResponseSchema>;
export type FraCheckinResponse = z.infer<typeof FraCheckinResponseSchema>;
export type WalkInResponse = z.infer<typeof WalkInResponseSchema>;

// ─── State ──────────────────────────────────────────────────────────────────

let baseUrl = '';
let jwtToken = '';

export function configure(nexusApiUrl: string): void {
  baseUrl = nexusApiUrl.replace(/\/+$/, '');
}

export function setToken(token: string): void {
  jwtToken = token;
}

export function isAuthenticated(): boolean {
  return jwtToken.length > 0;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  if (!baseUrl) throw new Error('Nexus API URL not configured');
  if (!jwtToken) throw new Error('Not authenticated to Nexus');

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Nexus API error ${res.status}: ${text}`);
  }

  const json: unknown = await res.json();
  return schema.parse(json);
}

// ─── Auth ───────────────────────────────────────────────────────────────────

const LoginResponseSchema = z.object({
  access_token: z.string(),
});

export async function login(username: string, password: string): Promise<string> {
  if (!baseUrl) throw new Error('Nexus API URL not configured');

  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`Login failed (${res.status})`);
  }

  const json: unknown = await res.json();
  const { access_token } = LoginResponseSchema.parse(json);
  jwtToken = access_token;
  return access_token;
}

// ─── Queue Operations ───────────────────────────────────────────────────────

/** Check in a regular appointment by ref code → creates queue entry in Nexus */
export async function checkin(refCode: string): Promise<CheckinResponse> {
  return post('/queue/checkin', { refCode }, CheckinResponseSchema);
}

/** Check in an FRA registration by transaction_ref → creates queue entry in Nexus */
export async function fraCheckin(transactionRef: string): Promise<FraCheckinResponse> {
  return post('/fra/checkin', { transactionRef }, FraCheckinResponseSchema);
}

/** Register a walk-in and create queue entry */
export async function walkIn(data: {
  readonly serviceType: string;
  readonly fname: string;
  readonly lname: string;
  readonly email: string;
  readonly mobileNo?: string;
}): Promise<WalkInResponse> {
  return post('/queue/walk-in', data, WalkInResponseSchema);
}

/** Check if Nexus API is reachable */
export async function checkConnection(): Promise<boolean> {
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/../`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
