import { useState, type FormEvent } from 'react';
import { createCriterion, listCriteria, updateCriterion } from '../../api/criteria';
import type { Criterion } from '../../api/types';
import { RoleShell } from '../../components/RoleShell';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Textarea } from '../../components/ui';
import { describeError, fieldErrorsFrom } from '../../lib/errors';
import { useAsync } from '../../lib/useAsync';

function CriterionForm({
  criterion,
  nextPosition,
  onSaved,
  onCancel,
}: {
  criterion?: Criterion;
  nextPosition: number;
  onSaved: (c: Criterion) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(criterion?.name ?? '');
  const [description, setDescription] = useState(criterion?.description ?? '');
  const [maxScore, setMaxScore] = useState(String(criterion?.maxScore ?? 10));
  const [weight, setWeight] = useState(String(criterion?.weight ?? 1));
  const [position, setPosition] = useState(String(criterion?.position ?? nextPosition));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    const max = Number(maxScore);
    const w = Number(weight);
    const pos = Number(position);
    if (!name.trim()) local.name = 'Ingresa el nombre del criterio.';
    if (!Number.isInteger(max) || max < 1 || max > 100) local.maxScore = 'Un entero entre 1 y 100.';
    if (!(w >= 0.01 && w <= 99.99) || Math.abs(w * 100 - Math.round(w * 100)) > 1e-9)
      local.weight = 'Entre 0.01 y 99.99, con máximo 2 decimales.';
    if (!Number.isInteger(pos) || pos < 0) local.position = 'Un entero mayor o igual a 0.';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      maxScore: max,
      weight: w,
      position: pos,
    };
    setSaving(true);
    try {
      onSaved(criterion ? await updateCriterion(criterion.id, body) : await createCriterion(body));
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFormError(describeError(err, 'criterion-save'));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={criterion ? 'Editar criterio' : 'Nuevo criterio'}>
      {formError && <Alert tone="error">{formError}</Alert>}
      <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} disabled={saving} />
      <Textarea
        label="Descripción (opcional)"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
        disabled={saving}
      />
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Input
          label="Puntaje máximo"
          type="number"
          inputMode="numeric"
          value={maxScore}
          onChange={(e) => setMaxScore(e.target.value)}
          error={errors.maxScore}
          disabled={saving}
        />
        <Input
          label="Peso"
          type="number"
          step="0.01"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          error={errors.weight}
          disabled={saving}
        />
        <Input
          label="Orden"
          type="number"
          inputMode="numeric"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          error={errors.position}
          disabled={saving}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving}>
          {criterion ? 'Guardar criterio' : 'Crear criterio'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function AdminCriteriaPage() {
  const criteria = useAsync(() => listCriteria(true), []);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const list = criteria.data;
  const nextPosition = list && list.length > 0 ? Math.max(...list.map((c) => c.position)) + 1 : 0;
  const active = list?.filter((c) => c.isActive) ?? [];
  const totalWeight = active.reduce((sum, c) => sum + c.weight, 0);

  function saved(message: string) {
    setCreating(false);
    setEditingId(null);
    setNotice(message);
    criteria.reload();
  }

  async function toggle(c: Criterion) {
    setToggleError(null);
    setTogglingId(c.id);
    try {
      await updateCriterion(c.id, { isActive: !c.isActive });
      setNotice(`Criterio «${c.name}» ${c.isActive ? 'desactivado' : 'activado'}.`);
      criteria.reload();
    } catch (err) {
      setToggleError(describeError(err, 'criterion-save'));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Criterios de evaluación"
          description="Define la rúbrica que usan los jueces. Los criterios no se eliminan: se desactivan para conservar las evaluaciones anteriores."
          actions={
            !creating && (
              <Button
                onClick={() => {
                  setCreating(true);
                  setEditingId(null);
                  setNotice(null);
                }}
              >
                Nuevo criterio
              </Button>
            )
          }
        />

        {notice && <Alert tone="success">{notice}</Alert>}
        {toggleError && <Alert tone="error">{toggleError}</Alert>}

        {creating && (
          <Card title="Nuevo criterio">
            <CriterionForm
              nextPosition={nextPosition}
              onSaved={(c) => saved(`Criterio «${c.name}» creado.`)}
              onCancel={() => setCreating(false)}
            />
          </Card>
        )}

        {list && active.length > 0 && (
          <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
            {active.length} criterio{active.length === 1 ? '' : 's'} activo{active.length === 1 ? '' : 's'} · suma de pesos{' '}
            <strong>{Math.round(totalWeight * 100) / 100}</strong>
          </p>
        )}

        <section aria-label="Lista de criterios" aria-busy={criteria.loading} className="space-y-3">
          {criteria.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(criteria.error)}</Alert>
              <Button variant="secondary" onClick={criteria.reload}>
                Reintentar
              </Button>
            </div>
          ) : !list ? (
            <Spinner label="Cargando criterios..." />
          ) : list.length === 0 ? (
            <EmptyState
              title="Aún no hay criterios"
              description="Crea el primer criterio para que los jueces cuenten con una rúbrica."
            />
          ) : (
            <ul className="space-y-3">
              {list.map((c) => (
                <li key={c.id}>
                  <Card>
                    {editingId === c.id ? (
                      <CriterionForm
                        criterion={c}
                        nextPosition={nextPosition}
                        onSaved={(s) => saved(`Criterio «${s.name}» actualizado.`)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold">
                            <span className="mr-2 text-slate-400">#{c.position}</span>
                            {c.name}
                          </p>
                          {c.description && <p className="mt-1 break-words text-sm text-slate-600">{c.description}</p>}
                          <p className="mt-1 text-xs text-slate-500">
                            Puntaje máx. {c.maxScore} · Peso {c.weight}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Activo' : 'Inactivo'}</Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Editar criterio ${c.name}`}
                            onClick={() => {
                              setEditingId(c.id);
                              setCreating(false);
                              setNotice(null);
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={togglingId === c.id}
                            aria-label={`${c.isActive ? 'Desactivar' : 'Activar'} criterio ${c.name}`}
                            onClick={() => void toggle(c)}
                          >
                            {c.isActive ? 'Desactivar' : 'Activar'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
