import { useEffect, useRef, useCallback } from 'react';

/**
 * Fires a callback after a period of user inactivity.
 * Resets on mouse move, click, keydown, and touch events.
 */
export function useIdleTimer(
  timeoutMs: number,
  onIdle: () => void,
  enabled = true
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (enabled) {
      timerRef.current = setTimeout(onIdle, timeoutMs);
    }
  }, [timeoutMs, onIdle, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const events: ReadonlyArray<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];

    resetTimer();
    for (const event of events) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of events) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [resetTimer, enabled]);
}
