import { useRef, useEffect } from 'react';

interface ScannerInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
}

/**
 * Input field that also captures HID scanner input.
 * Keeps focus aggressively — re-focuses after blur.
 */
export function ScannerInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Scan QR code or type...',
  className = '',
  autoFocus = true,
}: ScannerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep focus on the input
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;

    el.focus();

    const handleBlur = () => {
      // Re-focus after a small delay (allows clicking other buttons)
      setTimeout(() => {
        if (document.activeElement?.tagName !== 'INPUT' &&
            document.activeElement?.tagName !== 'SELECT' &&
            document.activeElement?.tagName !== 'TEXTAREA') {
          el.focus();
        }
      }, 200);
    };

    el.addEventListener('blur', handleBlur);
    return () => el.removeEventListener('blur', handleBlur);
  }, [autoFocus]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`w-full px-4 py-3 border-2 rounded-lg text-lg font-mono focus:outline-none focus:ring-2 ${className}`}
    />
  );
}
