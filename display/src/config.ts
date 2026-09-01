import { z } from 'zod';
import { isSecureOrPrivate, isTlsOrLoopback } from './net-address.js';
import { TcpFramingSchema } from './qtech/framing.js';
import { isPrivateHost } from './net-address.js';

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
const boolish = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1'),
]);

export const ConfigSchema = z.object({
  // ── Identity ────────────────────────────────────────────────────────────
  /** Distinguishes this bridge instance in the health table. One row per id. */
  bridgeId: z.string().min(1).default('mwo-owwa-primary'),

  // ── Supabase ────────────────────────────────────────────────────────────
  //
  // Since Qtech moved on-premises with no TLS and no credential, this is the
  // only leg that crosses the internet and the only one carrying a secret.
  // It is therefore the bridge's entire security boundary, and TLS here is
  // not negotiable. Loopback is exempt so the tests can use a local stub.
  supabaseUrl: z
    .string()
    .url()
    .refine(isTlsOrLoopback, {
      message:
        'must use https:// — this leg crosses the internet and carries the Supabase key',
    }),
  supabaseKey: z.string().min(1),

  // ── Qtech ───────────────────────────────────────────────────────────────
  /**
   * Which carrier to use. Qtech confirmed on 2026-08-20 that the JSON is
   * unchanged and only the transport differs, so both are kept: `tcp` is the
   * live path, `http` remains for the existing test suite and as a fallback
   * if the change is deferred.
   */
  qtechTransport: z.enum(['tcp', 'http']).default('tcp'),

  /** Qtech equipment on the PE network. */
  qtechTcpHost: z.string().min(1).default('127.0.0.1'),
  qtechTcpPort: z.coerce.number().int().min(1).max(65_535).default(4009),
  /** Sent as `clientId`. Qtech's reference client uses 'mwo-owwa'. */
  qtechClientId: z.string().min(1).default('mwo-owwa'),
  /**
   * Shared secret sent as `authToken` in every message. Qtech's response said
   * the on-premises protocol carries no authentication; their `call.bat`
   * reference client shows that it does. Treated as a secret: environment file
   * only, never in source control.
   *
   * Required whenever the TCP transport is in use — see the superRefine below
   * for why a default would be actively dangerous here.
   */
  qtechAuthToken: z.string().min(1).optional(),
  /**
   * How long to listen for a reply after writing. Qtech's client reads
   * nothing, and their protocol promises nothing, but a reply costs nothing to
   * accept and is the only way we would ever learn that a call was rejected.
   * Set to 0 to mirror their client exactly.
   */
  qtechAckWaitMs: z.coerce.number().int().min(0).max(10_000).default(250),
  /**
   * `offset` — `2026-09-01T11:55:33+08:00`, exactly as their client formats it.
   * `iso`    — `2026-09-01T03:55:33.072Z`, the same instant at full precision.
   * Defaults to matching their client, since a strict parser on their side
   * would reject the other and could not tell us.
   */
  qtechTimestampFormat: z.enum(['offset', 'iso']).default('offset'),
  /**
   * `epoch` — `T1756713333072`, as their client generates it.
   * `uuid`  — the check-in row id: opaque, collision-free, never reused.
   * Defaults to matching their client for the same reason as above.
   */
  qtechTicketIdStyle: z.enum(['epoch', 'uuid']).default('epoch'),
  /**
   * How one JSON message is delimited on the stream. Not yet specified by
   * Qtech; all plausible conventions are implemented so confirming it is a
   * configuration change rather than a code change. See qtech/framing.ts.
   */
  qtechTcpFraming: TcpFramingSchema.default('newline'),

  /**
   * The Qtech endpoint. On-premises as of 2026-08-20, so plaintext is expected
   * here and TLS is not offered.
   *
   * Plaintext is accepted only to a private address. Their justification for
   * dropping TLS is that the link never leaves the building; if the endpoint
   * is a public host then it does leave the building and the justification
   * does not survive with it, so the bridge refuses to start.
   */
  /** Only used when qtechTransport is 'http'. */
  qtechBaseUrl: z
    .string()
    .url()
    .default('http://127.0.0.1:9100')
    .refine(isSecureOrPrivate, {
      message:
        'plaintext is only allowed to a private address — a public host must use TLS',
    }),
  /** Optional since 2026-08-20: the on-premises protocol carries no auth. */
  qtechUsername: z.string().optional(),
  qtechPassword: z.string().optional(),
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
}).superRefine((cfg, ctx) => {
  // The TCP link carries no TLS and no credential. Qtech's justification is
  // that it never leaves the premises, so the same rule as the URL applies:
  // plaintext is permitted to a private address and refused to a public one.
  // A missing token must stop the bridge, not be papered over with a
  // placeholder. This protocol never replies, so a wrong token produces no
  // error anywhere: Qtech would reject every call, the health row would read
  // OK, and the wall would sit blank with nothing to explain why. Failing at
  // startup is the only place this can still be noticed.
  if (cfg.qtechTransport === 'tcp' && !cfg.qtechAuthToken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qtechAuthToken'],
      message:
        'QTECH_AUTH_TOKEN is required for the TCP transport. Qtech supply it — ' +
        'it is the TOKEN value in their call.bat reference client. Without it ' +
        'every call would be rejected silently, because this protocol sends no ' +
        'reply and there would be nothing to tell you.',
    });
  }

  if (cfg.qtechTransport === 'tcp' && !isPrivateHost(cfg.qtechTcpHost)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qtechTcpHost'],
      message:
        'the TCP link is plaintext, so it is only allowed to a private address — ' +
        'a public host would put the traffic on networks we do not control',
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    bridgeId: env.BRIDGE_ID,
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_KEY,
    qtechTransport: env.QTECH_TRANSPORT,
    qtechTcpHost: env.QTECH_TCP_HOST,
    qtechTcpPort: env.QTECH_TCP_PORT,
    qtechClientId: env.QTECH_CLIENT_ID,
    qtechAuthToken: env.QTECH_AUTH_TOKEN,
    qtechAckWaitMs: env.QTECH_ACK_WAIT_MS,
    qtechTimestampFormat: env.QTECH_TIMESTAMP_FORMAT,
    qtechTicketIdStyle: env.QTECH_TICKET_ID_STYLE,
    qtechTcpFraming: env.QTECH_TCP_FRAMING,
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
