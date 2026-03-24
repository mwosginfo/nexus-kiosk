interface OnScreenKeyboardProps {
  readonly mode: 'numeric' | 'alphanumeric';
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
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

export function OnScreenKeyboard({ mode, value, onChange, onSubmit }: OnScreenKeyboardProps) {
  function press(key: string) {
    onChange(value + key);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  const keyClass =
    'flex items-center justify-center min-w-[56px] h-14 rounded-xl bg-white border-2 border-gray-200 text-xl font-mono font-bold text-gray-800 active:bg-gray-200 active:border-gray-400 transition-colors select-none cursor-pointer hover:bg-gray-50';

  if (mode === 'numeric') {
    return (
      <div className="flex flex-col items-center gap-3">
        {NUMERIC_ROWS.map((row, i) => (
          <div key={i} className="flex gap-3">
            {row.map((key) => (
              <button key={key} className={`${keyClass} w-20`} onClick={() => press(key)}>
                {key}
              </button>
            ))}
            {i === 3 && (
              <button className={`${keyClass} w-20 text-red-500`} onClick={backspace}>
                &#9003;
              </button>
            )}
          </div>
        ))}
        <button
          className="mt-2 px-12 py-4 rounded-xl bg-teal-500 text-white text-xl font-bold hover:bg-teal-600 active:bg-teal-700 transition-colors"
          onClick={onSubmit}
        >
          Search
        </button>
      </div>
    );
  }

  // Alphanumeric
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Number row */}
      <div className="flex gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((key) => (
          <button key={key} className={`${keyClass} min-w-[48px] h-12 text-lg`} onClick={() => press(key)}>
            {key}
          </button>
        ))}
      </div>
      {/* Letter rows */}
      {ALPHA_ROWS.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          {row.map((key) => (
            <button key={key} className={`${keyClass} min-w-[48px] h-12 text-lg`} onClick={() => press(key)}>
              {key}
            </button>
          ))}
          {i === 2 && (
            <button className={`${keyClass} min-w-[64px] h-12 text-lg text-red-500`} onClick={backspace}>
              &#9003;
            </button>
          )}
        </div>
      ))}
      <button
        className="mt-2 px-12 py-3 rounded-xl bg-teal-500 text-white text-xl font-bold hover:bg-teal-600 active:bg-teal-700 transition-colors"
        onClick={onSubmit}
      >
        Search
      </button>
    </div>
  );
}
