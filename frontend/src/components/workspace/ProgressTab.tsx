import { useState, type FormEvent } from 'react';
import { addMilestone, deleteMilestone, listMilestones, setMilestoneCompleted } from '../../api/milestones';
import type { MilestoneList } from '../../api/types';
import { describeError } from '../../lib/errors';
import { formatDate } from '../../lib/labels';
import { PROJECT_TEAM_ROLES } from '../../lib/roles';
import { useAsync } from '../../lib/useAsync';
import { Alert, Button, Card, EmptyState, Input, ProgressBar, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

/** Milestones and progress (FR-017). Only the team edits, and only until the project goes under evaluation. */
export function ProgressTab({ project, role }: WorkspaceContext) {
  const milestones = useAsync(() => listMilestones(project.id), [project.id]);
  const isTeam = PROJECT_TEAM_ROLES.includes(role);
  const open = project.status === 'DRAFT' || project.status === 'SUBMITTED';
  const canEdit = isTeam && open;

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const apply = (list: MilestoneList) => milestones.setData(list);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setFieldError('Escribe el nombre del hito.');
      return;
    }
    setFieldError(undefined);
    setAdding(true);
    try {
      const result = await addMilestone(project.id, title.trim(), dueDate || null);
      apply(result);
      setTitle('');
      setDueDate('');
    } catch (err) {
      setError(describeError(err, 'milestone'));
    } finally {
      setAdding(false);
    }
  }

  async function run(id: string, action: () => Promise<MilestoneList | void>) {
    setError(null);
    setBusyId(id);
    try {
      const result = await action();
      if (result) apply(result);
      else milestones.reload();
    } catch (err) {
      setError(describeError(err, 'milestone'));
    } finally {
      setBusyId(null);
    }
  }

  if (milestones.error && !milestones.data) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{describeError(milestones.error)}</Alert>
        <Button variant="secondary" onClick={milestones.reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!milestones.data) return <Spinner label="Cargando avance..." />;

  const { data, progressPercent } = milestones.data;
  return (
    <div className="space-y-5">
      <Card>
        <ProgressBar value={progressPercent} label="Avance del proyecto" />
        <p className="mt-2 text-xs text-slate-500">
          {data.filter((m) => m.completed).length} de {data.length} hito{data.length === 1 ? '' : 's'} completado
          {data.length === 1 ? '' : 's'}.
        </p>
      </Card>

      {isTeam && !open && (
        <Alert tone="info">El avance está bloqueado porque el proyecto ya está en evaluación o fue evaluado.</Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {canEdit && (
        <Card title="Nuevo hito">
          <form onSubmit={add} noValidate className="grid items-end gap-x-4 sm:grid-cols-[1fr_12rem_auto]" aria-label="Nuevo hito">
            <Input label="Hito" value={title} onChange={(e) => setTitle(e.target.value)} error={fieldError} disabled={adding} />
            <Input
              label="Fecha límite (opcional)"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={adding}
            />
            <div className="pb-5">
              <Button type="submit" loading={adding}>
                Agregar hito
              </Button>
            </div>
          </form>
        </Card>
      )}

      {data.length === 0 ? (
        <EmptyState
          title="Aún no hay hitos"
          description={canEdit ? 'Agrega el primer hito para empezar a medir el avance.' : 'El equipo todavía no registra hitos.'}
        />
      ) : (
        <ul className="space-y-2" aria-label="Hitos">
          {data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <input
                type="checkbox"
                className="size-5 accent-brand-600"
                checked={m.completed}
                disabled={!canEdit || busyId === m.id}
                aria-label={`Marcar «${m.title}» como completado`}
                onChange={(e) => void run(m.id, () => setMilestoneCompleted(project.id, m.id, e.target.checked))}
              />
              <div className="min-w-0 flex-1">
                <p className={`break-words text-sm font-medium ${m.completed ? 'text-slate-500 line-through' : ''}`}>{m.title}</p>
                <p className="text-xs text-slate-500">
                  {m.dueDate ? `Fecha límite ${formatDate(m.dueDate)}` : 'Sin fecha límite'}
                  {m.completedAt ? ` · Completado ${formatDate(m.completedAt)}` : ''}
                </p>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busyId === m.id}
                  aria-label={`Eliminar hito ${m.title}`}
                  onClick={() => void run(m.id, () => deleteMilestone(project.id, m.id))}
                >
                  Eliminar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
