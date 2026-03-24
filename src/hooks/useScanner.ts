import { useRef, useCallback, useEffect } from 'react';

interface UseScannerOptions {
  /** Called when a barcode/QR scan is detected */
  readonly onScan: (value: string) => void;
  /** Minimum characters for a valid scan (default: 6) */
  readonly minLength?: number;
  /** Max time between keystrokes to count as scan, ms (default: 50) */
  readonly interKeystrokeMs?: number;
  /** Max total scan duration, ms (default: 500) */
  readonly maxDurationMs?: number;
  /** Whether scanner detection is active (default: true) */
  readonly enabled?: boolean;
}

/**
 * Detects HID barcode/QR scanner input by monitoring rapid keystroke timing.
 * HID scanners emit characters in rapid succession (<50ms apart) followed by Enter.
 */
export function useScanner({
  onScan,
  minLength = 6,
  interKeystrokeMs = 50,
  maxDurationMs = 500,
  enabled = true,
}: UseScannerOptions): void {
  const buffer = useRef('');
  const lastKeystroke = useRef(0);
  const scanStart = useRef(0);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const now = Date.now();

      if (e.key === 'Enter') {
        const totalDuration = now - scanStart.current;
        if (
          buffer.current.length >= minLength &&
          totalDuration <= maxDurationMs
        ) {
          e.preventDefault();
          e.stopPropagation();
          onScan(buffer.current);
        }
        buffer.current = '';
        lastKeystroke.current = 0;
        scanStart.current = 0;
        return;
      }

      // Only buffer printable single characters
      if (e.key.length !== 1) return;

      const timeSinceLast = now - lastKeystroke.current;

      if (lastKeystroke.current === 0 || timeSinceLast > interKeystrokeMs * 3) {
        // Start a new potential scan
        buffer.current = e.key;
        scanStart.current = now;
      } else if (timeSinceLast <= interKeystrokeMs * 3) {
        buffer.current += e.key;
      }

      lastKeystroke.current = now;
    },
    [onScan, minLength, interKeystrokeMs, maxDurationMs, enabled]
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown, enabled]);
}
