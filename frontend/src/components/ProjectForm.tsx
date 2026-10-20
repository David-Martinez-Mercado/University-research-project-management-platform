import { useState, type FormEvent } from 'react';
import type { Project } from '../api/types';
import { describeError, fieldErrorsFrom, type ErrorContext } from '../lib/errors';
import { Alert, Button, Input, Textarea } from './ui';

export interface ProjectFormValues {
  title: string;
  summary: string;
  researchArea: string;
  affiliation: string;
  description: string;
}

type FieldName = keyof ProjectFormValues;

// Same limits as the backend schemas (projects.schemas.ts); the server remains the authority.
const MAX: Record<FieldName, number> = {
  title: 300,
  summary: 2000,
  researchArea: 200,
  affiliation: 200,
  description: 20000,
};

const FIELD_NAMES = Object.keys(MAX) as FieldName[];

export function validateProjectValues(values: ProjectFormValues): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (!values.title.trim()) errors.title = 'El título es obligatorio.';
  for (const name of FIELD_NAMES) {
    if (values[name].trim().length > MAX[name]) errors[name] ??= `Máximo ${MAX[name]} caracteres.`;
  }
  return errors;
}

const toValues = (p?: Project): ProjectFormValues => ({
  title: p?.title ?? '',
  summary: p?.summary ?? '',
  researchArea: p?.researchArea ?? '',
  affiliation: p?.affiliation ?? '',
  description: p?.description ?? '',
});

export interface ProjectFormProps {
  /** Present when editing; the optional fields are then sent as null when emptied. */
  project?: Project;
  submitLabel: string;
  errorContext: ErrorContext;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  onCancel?: () => void;
}

/** Shared by "Nuevo proyecto" and the Overview edit mode, so both validate and report errors alike. */
export function ProjectForm({ project, submitLabel, errorContext, onSubmit, onCancel }: ProjectFormProps) {
  const [values, setValues] = useState<ProjectFormValues>(() => toValues(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bind = (name: FieldName) => ({
    name,
    value: values[name],
    error: errors[name],
    disabled: submitting,
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const clientErrors = validateProjectValues(values);
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) return;

    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFormError(describeError(err, errorContext));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <Input label="Título" required autoComplete="off" {...bind('title')} />
      <Textarea
        label="Resumen"
        rows={3}
        hint="Opcional. Una descripción breve que aparece en las listas."
        {...bind('summary')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Área de investigación" {...bind('researchArea')} />
        <Input
          label="Afiliación"
          hint={project ? undefined : 'Opcional. Si la dejas vacía se usa la de tu cuenta.'}
          {...bind('affiliation')}
        />
      </div>
      <Textarea
        label="Descripción"
        rows={8}
        hint="Obligatoria para poder enviar el proyecto a revisión."
        {...bind('description')}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={submitting}>
          {submitting ? 'Guardando...' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

/** Body for POST /projects: empty optional fields are omitted (the creator's affiliation is the default). */
export function toCreatePayload(v: ProjectFormValues) {
  const clean = (s: string) => s.trim() || undefined;
  return {
    title: v.title.trim(),
    summary: clean(v.summary),
    description: clean(v.description),
    researchArea: clean(v.researchArea),
    affiliation: clean(v.affiliation),
  };
}

/** Body for PUT /projects/:id: emptied optional fields are cleared with null. */
export function toUpdatePayload(v: ProjectFormValues) {
  const orNull = (s: string) => s.trim() || null;
  return {
    title: v.title.trim(),
    summary: orNull(v.summary),
    description: orNull(v.description),
    researchArea: orNull(v.researchArea),
    affiliation: orNull(v.affiliation),
  };
}
