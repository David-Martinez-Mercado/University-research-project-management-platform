import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
  /** Receives the props that tie the control to its label, hint and error message. */
  children: (control: {
    id: string;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}

/** Shared label + hint + error wrapper used by Input, Select and Textarea. */
export function Field({ label, error, hint, id, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={controlId} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
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

export const controlClasses = (error?: string) =>
  [
    'block w-full rounded-lg bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
    'ring-1 ring-inset placeholder:text-slate-400',
    'focus-visible:outline-2 focus-visible:outline-offset-0',
    'disabled:cursor-not-allowed disabled:bg-slate-100',
    error ? 'ring-red-500 focus-visible:outline-red-600' : 'ring-slate-300 focus-visible:outline-brand-600',
  ].join(' ');
