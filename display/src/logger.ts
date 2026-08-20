import type { Config } from './config.js';

/**
 * Structured line logger. systemd captures stdout/stderr into the journal, so
 * there is no file handling here.
 *
 * PII rule: this logger is only ever handed the projected fields in
 * `types.ts` (ids, queue numbers, counters, timestamps). Raw Supabase rows and
 * raw HTTP bodies must not be passed in — `kiosk_checkins` carries
 * `client_name` / `client_email` and the journal is not a PII store.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(config: Pick<Config, 'logLevel' | 'bridgeId'>): Logger {
  const threshold = LEVELS[config.logLevel];

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVELS[level] < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      bridge: config.bridgeId,
      msg,
      ...(fields ?? {}),
    };
    const text = JSON.stringify(line);
    if (level === 'error' || level === 'warn') process.stderr.write(`${text}\n`);
    else process.stdout.write(`${text}\n`);
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** Redacts anything that could carry a secret before it reaches the journal. */
export function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic ***').slice(0, 500);
}
