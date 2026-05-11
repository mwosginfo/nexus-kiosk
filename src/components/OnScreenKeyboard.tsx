interface OnScreenKeyboardProps {
  readonly mode: 'numeric' | 'alphanumeric';
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly accent?: 'navy' | 'burgundy';
  /** Show a wide space bar at the bottom of the alphanumeric layout */
  readonly allowSpace?: boolean;
  /** Override the Search button label */
  readonly submitLabel?: string;
}

const ALPHA_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
] as const;

const NUMERIC_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['+', '0'],
] as const;

export function OnScreenKeyboard({
  mode,
  value,
  onChange,
  onSubmit,
  accent = 'navy',
  allowSpace = false,
  submitLabel = 'Search',
}: OnScreenKeyboardProps) {
  function press(key: string) {
    onChange(value + key);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  // Generously sized for 2160x1440 kiosk hardware — fat-finger-friendly,
  // scales down to 1024px gracefully via clamp().
  // Key width target: ~7vw → on 2160px the row of 10 keys fills ~70% of viewport.
  const keyClass =
    'flex items-center justify-center rounded-2xl bg-white border-2 border-gray-200 ' +
    'w-[clamp(72px,6.6vw,148px)] h-[clamp(72px,6vw,140px)] ' +
    'text-[clamp(1.6rem,2.1vw,2.8rem)] font-mono font-bold text-brand-ink ' +
    'shadow-sm hover:bg-gray-50 hover:border-brand-navy/40 ' +
    'active:bg-gray-100 active:scale-[0.97] ' +
    'transition-[background-color,border-color,transform] duration-100 ' +
    'select-none focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-navy/30';

  const submitBg = accent === 'burgundy' ? 'bg-brand-burgundy' : 'bg-brand-navy';
  const submitHover = accent === 'burgundy' ? 'hover:bg-brand-burgundy/90' : 'hover:bg-brand-navy/90';
  const submitRing = accent === 'burgundy' ? 'focus-visible:ring-brand-burgundy/40' : 'focus-visible:ring-brand-navy/40';

  if (mode === 'numeric') {
    return (
      <div className="flex flex-col items-center gap-[clamp(0.7rem,0.9vw,1.4rem)] w-[70vw] max-w-[1500px]">
        {NUMERIC_ROWS.map((row, i) => (
          <div key={i} className="flex gap-[clamp(0.7rem,0.9vw,1.4rem)] justify-center">
            {row.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={`Key ${key}`}
                className={keyClass}
                onClick={() => press(key)}
              >
                {key}
              </button>
            ))}
            {i === 3 && (
              <button
                type="button"
                aria-label="Backspace"
                className={`${keyClass} text-brand-burgundy`}
                onClick={backspace}
              >
                &#9003;
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className={`${submitBg} ${submitHover} mt-[clamp(0.6rem,1vw,1.4rem)] px-[clamp(3rem,5vw,7rem)] py-[clamp(1rem,1.4vw,1.9rem)] rounded-2xl text-white text-[clamp(1.2rem,1.6vw,1.9rem)] font-bold tracking-wide transition-[background-color] duration-150 focus:outline-none focus-visible:ring-4 ${submitRing}`}
          onClick={onSubmit}
        >
          Search
        </button>
      </div>
    );
  }

  // Alphanumeric — number row of 10 keys fills ~70% of viewport at 2160 width
  return (
    <div className="flex flex-col items-center gap-[clamp(0.5rem,0.7vw,1.1rem)] w-[70vw] max-w-[1600px]">
      <div className="flex gap-[clamp(0.5rem,0.7vw,1.1rem)] justify-center">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`Key ${key}`}
            className={keyClass}
            onClick={() => press(key)}
          >
            {key}
          </button>
        ))}
      </div>
      {ALPHA_ROWS.map((row, i) => (
        <div key={i} className="flex gap-[clamp(0.5rem,0.7vw,1.1rem)] justify-center">
          {row.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`Key ${key}`}
              className={keyClass}
              onClick={() => press(key)}
            >
              {key}
            </button>
          ))}
          {i === 2 && (
            <button
              type="button"
              aria-label="Backspace"
              className={`${keyClass} text-brand-burgundy w-[clamp(96px,8.5vw,200px)]`}
              onClick={backspace}
            >
              &#9003;
            </button>
          )}
        </div>
      ))}
      {allowSpace && (
        <div className="flex gap-[clamp(0.5rem,0.7vw,1.1rem)] justify-center">
          <button
            type="button"
            aria-label="Space"
            className={`${keyClass} w-[clamp(360px,32vw,720px)] text-base tracking-[0.4em] text-gray-500`}
            onClick={() => press(' ')}
          >
            SPACE
          </button>
        </div>
      )}
      <button
        type="button"
        className={`${submitBg} ${submitHover} mt-[clamp(0.6rem,1vw,1.4rem)] px-[clamp(3rem,5vw,7rem)] py-[clamp(1rem,1.4vw,1.9rem)] rounded-2xl text-white text-[clamp(1.2rem,1.6vw,1.9rem)] font-bold tracking-wide transition-[background-color] duration-150 focus:outline-none focus-visible:ring-4 ${submitRing}`}
        onClick={onSubmit}
      >
        {submitLabel}
      </button>
    </div>
  );
}
