/**
 * Retry policy, transcribed from the Qtech integration response §4:
 *
 *   "Retry only on network failure, timeout, HTTP 5xx, or HTTP 429.
 *    Do not retry on a business error — the outcome will not change on repeat.
 *    Recommended: exponential backoff at 1s / 2s / 4s, maximum 3 attempts,
 *    then log and stop. Stopping is safe: the next call event supersedes the
 *    lost one."
 *
 * The delay table carries the full 1/2/4 sequence even though MAX_ATTEMPTS=3
 * only consumes the first two, so raising the cap needs no other change.
 */
export const BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];
export const MAX_ATTEMPTS = 3;

/** Delay before the given 1-based attempt. Attempt 1 is immediate. */
export function delayBeforeAttempt(attempt: number): number {
  if (attempt <= 1) return 0;
  return BACKOFF_MS[attempt - 2] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 4_000;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
