/**
 * Per-counter serialisation.
 *
 * Qtech integration response §4 (Ordering): "If two calls for the same counter
 * are sent concurrently, the one that arrives last is the one left on the
 * display. MWO-OWWA should serialise calls per counter so that a stale call
 * cannot overwrite a newer one."
 *
 * Nexus can genuinely produce two calls at one counter within milliseconds —
 * calling the next client auto-misses the one currently at that counter, so
 * both rows change in the same beat. Without serialisation those two POSTs
 * race and the wall can settle on the older number.
 *
 * Ordering is strict FIFO with one request in flight per counter. Queued
 * events are NOT collapsed: each represents a real announcement, and Qtech
 * applies them in arrival order, so the newest still wins the display.
 * Different counters run concurrently.
 */
export class PerCounterQueue {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly depths = new Map<string, number>();

  /** Queue `task` behind any work already pending for `counterName`. */
  enqueue(counterName: string, task: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(counterName) ?? Promise.resolve();
    this.depths.set(counterName, (this.depths.get(counterName) ?? 0) + 1);

    const next = previous.then(task, task).finally(() => {
      const depth = (this.depths.get(counterName) ?? 1) - 1;
      if (depth <= 0) {
        this.depths.delete(counterName);
        // Only clear the chain if nothing arrived while we were running,
        // otherwise we would let a later task jump the queue.
        if (this.chains.get(counterName) === next) this.chains.delete(counterName);
      } else {
        this.depths.set(counterName, depth);
      }
    });

    this.chains.set(counterName, next);
    return next;
  }

  /** Total queued-or-running tasks across all counters. */
  get pending(): number {
    let total = 0;
    for (const depth of this.depths.values()) total += depth;
    return total;
  }

  /** Resolves once every queued task has settled. Used on shutdown. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }
}
