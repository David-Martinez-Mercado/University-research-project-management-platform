import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
}

export function Input({ label, error, hint, id, className, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'block w-full rounded-md bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
          'ring-1 ring-inset placeholder:text-slate-400',
          'focus-visible:outline-2 focus-visible:outline-offset-0',
          'disabled:cursor-not-allowed disabled:bg-slate-100',
          error
            ? 'ring-red-500 focus-visible:outline-red-600'
            : 'ring-slate-300 focus-visible:outline-brand-600',
          className,
        )}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {/* Always mounted so assistive tech announces the message when it appears. */}
      <p id={errorId} aria-live="polite" className="min-h-4 text-xs font-medium text-red-700">
        {error}
      </p>
    </div>
  );
}
