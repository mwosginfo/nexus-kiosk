import { loadConfig } from './config.js';
import { createLogger, safeError } from './logger.js';
import { createSupabaseClient } from './supabase/client.js';
import { CallWatcher, type CandidateSource } from './supabase/watcher.js';
import { HealthWriter } from './supabase/health-writer.js';
import { QtechClient } from './qtech/client.js';
import { Dispatcher } from './dispatch/dispatcher.js';
import type { CallCandidate } from './types.js';

const VERSION = '1.0.0';

/**
 * Nexus → Supabase → bridge → Qtech.
 *
 *   Nexus writes call state into Supabase `kiosk_checkins` (it already does
 *   this for its own queue). This process watches that table, turns each
 *   change into a discrete call event, and POSTs it to Qtech. It has no
 *   connection to Nexus in either direction.
 *
 *   Health flows back the same way: the bridge keeps a row in
 *   `qtech_bridge_health` current, and Nexus reads `qtech_bridge_status` to
 *   know whether the wall is being fed.
 */
async function main(): Promise<void> {
  // Qtech item 7.1 requires certificate validation to be enabled. Node does
  // this by default, but a stray NODE_TLS_REJECT_UNAUTHORIZED=0 in the unit
  // file or the shell silently turns it off process-wide — and a bridge that
  // trusts any certificate is a bridge that will happily hand its Basic
  // credentials to whatever answers. Refuse to run rather than run insecurely.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error(
      'NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate validation, which ' +
        'the Qtech integration requires. Unset it before starting the bridge.',
    );
  }

  const config = loadConfig();
  const logger = createLogger(config);
  const controller = new AbortController();

  logger.info('starting nexus-qtech-bridge', {
    version: VERSION,
    bridgeId: config.bridgeId,
    dryRun: config.dryRun,
    counterNameFormat: config.counterNameFormat,
    allowedCounters: config.allowedCounters.join(','),
    resyncOnStart: config.resyncOnStart,
  });

  const supabase = createSupabaseClient(config);
  const health = new HealthWriter(supabase, config, logger, VERSION);
  const qtech = new QtechClient(config, logger);
  const dispatcher = new Dispatcher(qtech, health, logger, controller.signal);

  const onCandidate = (candidate: CallCandidate, source: CandidateSource): void => {
    // A call the reconcile poll found means Realtime did not deliver it.
    // Tracked separately: a rising count while realtime_connected is true is
    // the fingerprint of a subscription that has died without saying so.
    if (source === 'poll') health.noteRecoveredByPoll();
    dispatcher.submit(candidate);
  };

  const watcher = new CallWatcher(supabase, config, logger, {
    onCandidate,
    onRealtimeState: (connected) => health.setRealtimeConnected(connected),
    onRealtimeEvent: () => health.noteRealtimeEvent(),
    onReconcile: () => health.noteReconcile(),
  });

  health.start();

  // Periodic liveness probe against Qtech's own /health endpoint (§1). This is
  // what distinguishes "no calls happening" from "we could not reach Qtech if
  // we tried" during a quiet stretch.
  const probe = async (): Promise<void> => {
    const ok = await qtech.health();
    health.noteQtechHealth(ok);
    if (!ok) logger.warn('qtech /health probe reported not-ok');
  };
  await probe();
  const probeTimer = setInterval(() => void probe(), config.qtechHealthIntervalMs);

  await watcher.start();
  logger.info('bridge running');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal, pendingCalls: dispatcher.pending });
    controller.abort();
    clearInterval(probeTimer);
    await watcher.stop();
    await dispatcher.drain();
    await health.stop();
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // An unhandled rejection must not leave a half-dead process that still
  // heartbeats — that would report OK while delivering nothing.
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: safeError(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception — exiting for systemd to restart', {
      error: safeError(err),
    });
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'fatal: bridge failed to start',
      error: safeError(err),
    })}\n`,
  );
  process.exit(1);
});
