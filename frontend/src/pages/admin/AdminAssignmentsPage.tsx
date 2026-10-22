import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createAssignment, deleteAssignment, listAssignments } from '../../api/assignments';
import { listProjects } from '../../api/projects';
import type { AssignmentStatus, JudgeAssignment, Project } from '../../api/types';
import { listUsers } from '../../api/users';
import { StatusBadge } from '../../components/badges';
import { RoleShell } from '../../components/RoleShell';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Pagination, Select, Spinner } from '../../components/ui';
import { describeError } from '../../lib/errors';
import { formatDateTime } from '../../lib/labels';
import { useAsync } from '../../lib/useAsync';

const PAGE_SIZE = 10;

const ASSIGNMENT_LABELS: Record<AssignmentStatus, string> = {
  ASSIGNED: 'Asignado',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completado',
};

/** Projects a judge can be assigned to (the backend only accepts these two states). */
async function loadAssignableProjects(): Promise<Project[]> {
  const [submitted, evaluating] = await Promise.all([
    listProjects({ status: 'SUBMITTED', limit: 100 }),
    listProjects({ status: 'UNDER_EVALUATION', limit: 100 }),
  ]);
  return [...submitted.data, ...evaluating.data];
}

export function AdminAssignmentsPage() {
  const [offset, setOffset] = useState(0);
  const assignments = useAsync(() => listAssignments({ limit: PAGE_SIZE, offset }), [offset]);
  const projects = useAsync(loadAssignableProjects, []);
  const judges = useAsync(() => listUsers({ role: 'JUDGE', limit: 100 }).then((p) => p.data.filter((u) => u.isActive)), []);

  const [projectId, setProjectId] = useState('');
  const [judgeId, setJudgeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!projectId || !judgeId) {
      setFormError('Elige un proyecto y un juez.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const created = await createAssignment(projectId, judgeId);
      setNotice(`${created.judge.fullName} fue asignado a «${created.project.title}».`);
      setJudgeId('');
      setOffset(0);
      assignments.reload();
    } catch (err) {
      // 422 carries the conflict-of-interest reasons (FR-010); the backend is the only judge of it.
      setFormError(describeError(err, 'assignment-create'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: JudgeAssignment) {
    setRemoveError(null);
    setNotice(null);
    setRemovingId(a.id);
    try {
      await deleteAssignment(a.id);
      setNotice(`Se quitó la asignación de ${a.judge.fullName}.`);
      assignments.reload();
    } catch (err) {
      setRemoveError(describeError(err, 'assignment-delete'));
    } finally {
      setRemovingId(null);
    }
  }

  const page = assignments.data;

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Asignación de jueces"
          description="Asigna jueces a proyectos enviados. El sistema rechaza la asignación si el juez es dueño o colaborador del proyecto, o comparte su afiliación."
        />

        {notice && <Alert tone="success">{notice}</Alert>}

        <Card title="Nueva asignación">
          <form onSubmit={submit} noValidate className="space-y-3" aria-label="Nueva asignación">
            {formError && <Alert tone="error">{formError}</Alert>}
            {!!(projects.error || judges.error) && (
              <Alert tone="error">{describeError(projects.error ?? judges.error)}</Alert>
            )}
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Select
                label="Proyecto"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={saving || !projects.data}
                hint={projects.data && projects.data.length === 0 ? 'No hay proyectos Enviados o En evaluación.' : undefined}
              >
                <option value="">Selecciona un proyecto</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
              <Select
                label="Juez"
                value={judgeId}
                onChange={(e) => setJudgeId(e.target.value)}
                disabled={saving || !judges.data}
                hint={judges.data && judges.data.length === 0 ? 'No hay jueces activos. Crea uno en Usuarios.' : undefined}
              >
                <option value="">Selecciona un juez</option>
                {judges.data?.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.fullName}
                    {j.affiliation ? ` — ${j.affiliation}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" loading={saving}>
              Asignar juez
            </Button>
          </form>
        </Card>

        <section aria-label="Asignaciones" aria-busy={assignments.loading} className="space-y-3">
          <h2 className="text-lg font-semibold">Asignaciones actuales</h2>
          {removeError && <Alert tone="error">{removeError}</Alert>}
          {assignments.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(assignments.error)}</Alert>
              <Button variant="secondary" onClick={assignments.reload}>
                Reintentar
              </Button>
            </div>
          ) : !page ? (
            <Spinner label="Cargando asignaciones..." />
          ) : page.data.length === 0 ? (
            <EmptyState title="Aún no hay asignaciones" description="Cuando asignes un juez a un proyecto aparecerá aquí." />
          ) : (
            <>
              <ul className="space-y-3">
                {page.data.map((a) => (
                  <li key={a.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold">
                            <Link to={`/projects/${a.project.id}`} className="text-brand-700 hover:underline">
                              {a.project.title}
                            </Link>
                          </p>
                          <p className="text-sm text-slate-600">
                            Juez: {a.judge.fullName} ({a.judge.email})
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Asignado {formatDateTime(a.assignedAt)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={a.project.status} />
                          <Badge tone={a.status === 'COMPLETED' ? 'success' : 'info'}>{ASSIGNMENT_LABELS[a.status]}</Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={removingId === a.id}
                            aria-label={`Quitar a ${a.judge.fullName} de ${a.project.title}`}
                            onClick={() => void remove(a)}
                          >
                            Quitar
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination
                total={page.total}
                limit={page.limit}
                offset={page.offset}
                disabled={assignments.loading}
                onChange={setOffset}
              />
            </>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
