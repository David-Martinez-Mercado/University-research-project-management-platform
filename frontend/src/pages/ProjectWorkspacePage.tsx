import { useSearchParams, useParams, Link } from 'react-router-dom';
import { getProject, listCollaborators } from '../api/projects';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/badges';
import { RoleShell } from '../components/RoleShell';
import { Alert, Button, Spinner, Tabs, type TabItem } from '../components/ui';
import { CollaboratorsTab } from '../components/workspace/CollaboratorsTab';
import { DocumentsTab } from '../components/workspace/DocumentsTab';
import { OverviewTab } from '../components/workspace/OverviewTab';
import { PlaceholderTab } from '../components/workspace/PlaceholderTab';
import type { WorkspaceContext } from '../components/workspace/types';
import type { Project, Role } from '../api/types';
import { describeError } from '../lib/errors';
import { PROJECT_TEAM_ROLES } from '../lib/roles';
import { useAsync } from '../lib/useAsync';

type TabId = 'overview' | 'documents' | 'collaborators' | 'ai' | 'progress';

/** Tabs a role may open. INVESTOR has no Documents tab; JUDGE/INVESTOR cannot read collaborators. */
export function tabsForRole(role: Role): TabItem[] {
  const tabs: Array<TabItem & { id: TabId }> = [{ id: 'overview', label: 'Vista general' }];
  if (role !== 'INVESTOR') tabs.push({ id: 'documents', label: 'Documentos' });
  if (PROJECT_TEAM_ROLES.includes(role)) tabs.push({ id: 'collaborators', label: 'Colaboradores' });
  tabs.push({ id: 'ai', label: 'Asistente IA' }, { id: 'progress', label: 'Progreso' });
  return tabs;
}

export function ProjectWorkspacePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const isTeamRole = !!user && PROJECT_TEAM_ROLES.includes(user.role);
  const project = useAsync(() => getProject(id), [id]);
  // Collaborators are loaded here (not in the tab) because Overview also needs them to know whether
  // the caller is a LEAD. JUDGE and INVESTOR get 403 from this endpoint, so they never request it.
  const collaborators = useAsync(
    () => (isTeamRole ? listCollaborators(id) : Promise.resolve([])),
    [id, isTeamRole],
  );

  if (!user) return null;

  const tabs = tabsForRole(user.role);
  const requested = params.get('tab');
  const selected = tabs.find((t) => t.id === requested)?.id ?? 'overview';

  const current = project.data;
  const notFound = project.error instanceof ApiError && project.error.status === 404;

  let body;
  if (project.error && !current) {
    body = (
      <div className="space-y-3">
        <Alert tone="error">
          {notFound
            ? 'No se encontró el proyecto, o no tienes acceso a él.'
            : describeError(project.error)}
        </Alert>
        {!notFound && (
          <Button variant="secondary" onClick={project.reload}>
            Reintentar
          </Button>
        )}
      </div>
    );
  } else if (!current) {
    body = <Spinner label="Cargando proyecto..." />;
  } else {
    const canManage =
      user.role === 'ADMINISTRATOR' ||
      current.ownerId === user.id ||
      !!collaborators.data?.some((c) => c.userId === user.id && c.role === 'LEAD');

    const ctx: WorkspaceContext = {
      project: current,
      onProjectChange: (p: Project) => project.setData(p),
      role: user.role,
      userId: user.id,
      canManage,
      collaborators: isTeamRole ? collaborators : null,
    };

    body = (
      <div className="space-y-6">
        <div>
          <h1 className="break-words text-2xl font-semibold">{current.title}</h1>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={current.status} />
          </div>
        </div>
        <Tabs
          label="Secciones del proyecto"
          tabs={tabs}
          selectedId={selected}
          onSelect={(tab) => setParams({ tab }, { replace: true })}
        >
          {selected === 'overview' && <OverviewTab {...ctx} />}
          {selected === 'documents' && <DocumentsTab {...ctx} />}
          {selected === 'collaborators' && <CollaboratorsTab {...ctx} />}
          {selected === 'ai' && (
            <PlaceholderTab name="Asistente IA" description="Aquí podrás hacer preguntas sobre los documentos del proyecto." />
          )}
          {selected === 'progress' && (
            <PlaceholderTab name="Progreso" description="Aquí verás el avance y los hitos del proyecto." />
          )}
        </Tabs>
      </div>
    );
  }

  return (
    <RoleShell>
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-block text-sm text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          ← Volver a proyectos
        </Link>
        {body}
      </div>
    </RoleShell>
  );
}
