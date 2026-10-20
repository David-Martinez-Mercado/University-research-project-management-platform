import type { InputHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { controlClasses, Field } from './Field';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
}

export function Input({ label, error, hint, id, className, ...rest }: InputProps) {
  return (
    <Field label={label} error={error} hint={hint} id={id}>
      {(control) => <input {...control} className={cx(controlClasses(error), className)} {...rest} />}
    </Field>
  );
}
