/** Accessible progress bar: the percentage is always also shown as text. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2.5 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
