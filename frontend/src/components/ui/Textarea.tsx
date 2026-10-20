import type { TextareaHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { controlClasses, Field } from './Field';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
}

export function Textarea({ label, error, hint, id, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <Field label={label} error={error} hint={hint} id={id}>
      {(control) => <textarea {...control} rows={rows} className={cx(controlClasses(error), className)} {...rest} />}
    </Field>
  );
}
