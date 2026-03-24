interface QueueNumberDisplayProps {
  readonly number: string;
  readonly label?: string;
  readonly variant?: 'success' | 'info';
}

/** Large queue number display for after check-in */
export function QueueNumberDisplay({
  number,
  label = 'Queue Number',
  variant = 'success',
}: QueueNumberDisplayProps) {
  const colors = variant === 'success'
    ? 'bg-green-50 border-green-200 text-green-800'
    : 'bg-blue-50 border-blue-200 text-blue-800';

  const numberColor = variant === 'success' ? 'text-green-700' : 'text-blue-700';

  return (
    <div className={`rounded-2xl border-2 p-8 text-center ${colors}`}>
      <p className="text-sm font-medium uppercase tracking-wider mb-2 opacity-70">{label}</p>
      <p className={`text-7xl font-bold font-mono tracking-widest ${numberColor}`}>
        {number}
      </p>
    </div>
  );
}
