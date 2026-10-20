import type { SelectHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { controlClasses, Field } from './Field';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
}

/** Native <select> (best keyboard and screen reader support); pass <option> children. */
export function Select({ label, error, hint, id, className, children, ...rest }: SelectProps) {
  return (
    <Field label={label} error={error} hint={hint} id={id}>
      {(control) => (
        <select {...control} className={cx(controlClasses(error), className)} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}
