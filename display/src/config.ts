import { z } from 'zod';

/**
 * Configuration for the bridge, parsed from the environment exactly once at
 * boot. Parse-don't-validate: nothing downstream ever touches `process.env`.
 *
 * The Qtech Basic-auth secret is supplied via the environment (systemd
 * `EnvironmentFile=` pointing at a root-owned 0600 file). It is never written
 * to source control and can be replaced without a code change, per the Qtech
 * integration response item 7.2.
 */

const csvNumbers = z
  .string()
  .transform((raw) =>
    raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => Number(part)),
  )
  .refine((nums) => nums.length > 0 && nums.every((n) => Number.isInteger(n) && n > 0), {
    message: 'must be a comma-separated list of positive integers',
  });

/**
 * Accepts both the environment form ("true" / "1") and a real boolean, so the
 * schema can parse its own output. Without the boolean branch, `Config` is not
 * a valid input to `ConfigSchema`, which makes programmatic construction (and
 * every test that builds a config) unsound.
 */
/** Allows http:// only for 127.0.0.1 / ::1 / localhost, for the test stubs. */
function isHttpsOrLoopback(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

const boolish = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1'),
]);

export const ConfigSchema = z.object({
  // ── Identity ────────────────────────────────────────────────────────────
  /** Distinguishes this bridge instance in the health table. One row per id. */
  bridgeId: z.string().min(1).default('mwo-owwa-primary'),

  // ── Supabase (the bridge's ONLY inbound dependency) ─────────────────────
  supabaseUrl: z.string().url(),
  supabaseKey: z.string().min(1),

  // ── Qtech ───────────────────────────────────────────────────────────────
  /**
   * e.g. https://<tenant>.qtechqms.com/api/v1/ops — no trailing slash.
   *
   * Must be HTTPS. Qtech §3 is unambiguous: "HTTPS only, TLS 1.2 or higher.
   * Plain HTTP is not offered for this integration." Without this check a
   * mistyped env var would ship the Basic-auth secret in cleartext and the
   * only symptom would be that it worked. Loopback is exempt so the delivery
   * tests can run against a local stub.
   */
  qtechBaseUrl: z
    .string()
    .url()
    .refine(isHttpsOrLoopback, {
      message: 'must use https:// (Qtech does not offer plain HTTP)',
    }),
  qtechUsername: z.string().min(1),
  qtechPassword: z.string().min(1),
  /** Issued by Qtech at onboarding; constant for the life of the branch. */
  qtechBranchUuid: z.string().min(1),
  /** Client timeout in ms. Qtech responds within 5s; they recommend 10s. */
  qtechTimeoutMs: z.coerce.number().int().min(1_000).max(60_000).default(10_000),

  // ── Counter naming ──────────────────────────────────────────────────────
  /**
   * How `kiosk_checkins.counter_number` becomes Qtech's `counterName`.
   * `number`   → "7"          (safest: Qtech's voice is pre-recorded and only
   *                            announces numeric counter names)
   * `prefixed` → "Counter 7"  (also numeric-announceable per their item 2)
   */
  counterNameFormat: z.enum(['number', 'prefixed']).default('number'),
  /** The counter list agreed with Qtech at setup. Anything else is blocked
   *  locally rather than sent and rejected as COUNTER_UNKNOWN. */
  allowedCounters: csvNumbers.default('1,2,3,4,5,6,7,8,9,10'),

  // ── Watcher cadence ─────────────────────────────────────────────────────
  /** Safety-net re-read of today's CALLED rows. Realtime is the primary path;
   *  this catches events a silently-dropped subscription would have lost. */
  reconcileIntervalMs: z.coerce.number().int().min(2_000).max(300_000).default(15_000),
  /** Heartbeat write cadence. The DOWN threshold in the SQL view is 90s. */
  heartbeatIntervalMs: z.coerce.number().int().min(5_000).max(60_000).default(15_000),
  /** GET /health probe cadence against Qtech. */
  qtechHealthIntervalMs: z.coerce.number().int().min(30_000).max(3_600_000).default(120_000),

  /**
   * On boot, re-assert the most recent call at each counter with
   * `silent: true` so the wall shows correct current state after a restart
   * without chiming. `silent` is a documented optional field on POST /call.
   * Disable if Qtech prefers no traffic at startup.
   */
  resyncOnStart: boolish.default(true),

  /**
   * Dry run: do everything except the outbound POST /call. Health rows and the
   * call log are still written, with outcome DRY_RUN. Used for Phase 0/1
   * rehearsal against production data without touching a display.
   */
  dryRun: boolish.default(false),

  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    bridgeId: env.BRIDGE_ID,
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_KEY,
    qtechBaseUrl: env.QTECH_BASE_URL,
    qtechUsername: env.QTECH_USERNAME,
    qtechPassword: env.QTECH_PASSWORD,
    qtechBranchUuid: env.QTECH_BRANCH_UUID,
    qtechTimeoutMs: env.QTECH_TIMEOUT_MS,
    counterNameFormat: env.QTECH_COUNTER_NAME_FORMAT,
    allowedCounters: env.QTECH_ALLOWED_COUNTERS,
    reconcileIntervalMs: env.RECONCILE_INTERVAL_MS,
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
    qtechHealthIntervalMs: env.QTECH_HEALTH_INTERVAL_MS,
    resyncOnStart: env.RESYNC_ON_START,
    dryRun: env.DRY_RUN,
    logLevel: env.LOG_LEVEL,
  });
}
