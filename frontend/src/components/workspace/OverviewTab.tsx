import { useState, type ReactNode } from 'react';
import { changeProjectStatus, updateProject } from '../../api/projects';
import type { ProjectStatus } from '../../api/types';
import { describeError } from '../../lib/errors';
import { formatDateTime, STATUS_LABELS } from '../../lib/labels';
import { offeredActions } from '../../lib/lifecycle';
import { StatusBadge } from '../badges';
import { ProjectForm, toUpdatePayload } from '../ProjectForm';
import { Alert, Button, Card } from '../ui';
import type { WorkspaceContext } from './types';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}

const NOT_SET = <span className="text-slate-500">Sin definir</span>;

export function OverviewTab({ project, onProjectChange, role, canManage, collaborators }: WorkspaceContext) {
  const [editing, setEditing] = useState(false);
  const [busyTo, setBusyTo] = useState<ProjectStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const isAdmin = role === 'ADMINISTRATOR';
  // Same rule as the backend: managers edit DRAFT only; the administrator edits in any status.
  const canEdit = canManage && (isAdmin || project.status === 'DRAFT');
  const actions = offeredActions(project.status, project.allowedNextStatuses, role, canManage);
  const owner = collaborators?.data?.find((c) => c.isOwner);

  async function runTransition(to: ProjectStatus) {
    setBusyTo(to);
    setStatusError(null);
    setStatusNotice(null);
    try {
      const updated = await changeProjectStatus(project.id, to);
      onProjectChange(updated);
      setEditing(false);
      setStatusNotice(`El estado del proyecto cambió a ${STATUS_LABELS[updated.status]}.`);
    } catch (err) {
      setStatusError(describeError(err, 'status'));
    } finally {
      setBusyTo(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Estado"
        description={
          canManage || isAdmin
            ? 'Las acciones disponibles dependen del estado actual y de tu rol.'
            : 'Vista de solo lectura.'
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={project.status} />
            {project.submittedAt && (
              <span className="text-sm text-slate-600">Enviado el {formatDateTime(project.submittedAt)}</span>
            )}
          </div>
          {/* Alert is role=status (success) / role=alert (error): announced without moving focus. */}
          {statusNotice && <Alert tone="success">{statusNotice}</Alert>}
          {statusError && <Alert tone="error">{statusError}</Alert>}
          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {actions.map((action) => (
                <Button
                  key={action.to}
                  variant={action.to === 'DRAFT' ? 'secondary' : 'primary'}
                  loading={busyTo === action.to}
                  disabled={busyTo !== null}
                  onClick={() => runTransition(action.to)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No hay acciones de estado disponibles para tu rol en este momento.</p>
          )}
        </div>
      </Card>

      {editing ? (
        <Card title="Editar proyecto">
          <ProjectForm
            project={project}
            submitLabel="Guardar cambios"
            errorContext="project-save"
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              const updated = await updateProject(project.id, toUpdatePayload(values));
              onProjectChange(updated);
              setEditing(false);
              setStatusNotice('Los cambios se guardaron.');
            }}
          />
        </Card>
      ) : (
        <Card
          title="Información del proyecto"
          description={
            !canEdit && canManage ? 'Solo se puede editar mientras el proyecto está en borrador.' : undefined
          }
          footer={
            canEdit ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar proyecto
              </Button>
            ) : undefined
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Detail label="Título">{project.title}</Detail>
            </div>
            <div className="sm:col-span-2">
              <Detail label="Resumen">{project.summary || NOT_SET}</Detail>
            </div>
            <Detail label="Área de investigación">{project.researchArea || NOT_SET}</Detail>
            <Detail label="Afiliación">{project.affiliation || NOT_SET}</Detail>
            {owner && <Detail label="Dueño">{owner.fullName}</Detail>}
            <Detail label="Creado">{formatDateTime(project.createdAt)}</Detail>
            <Detail label="Última actualización">{formatDateTime(project.updatedAt)}</Detail>
            <div className="sm:col-span-2">
              <Detail label="Descripción">{project.description || NOT_SET}</Detail>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
