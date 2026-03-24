import { todaySGT } from '../lib/constants';

interface DatePickerProps {
  readonly value: string;
  readonly onChange: (date: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border rounded-lg text-sm bg-white"
      />
      {value !== todaySGT() && (
        <button
          onClick={() => onChange(todaySGT())}
          className="px-3 py-2 text-xs text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100"
        >
          Today
        </button>
      )}
    </div>
  );
}
