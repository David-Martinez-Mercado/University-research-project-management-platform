import { useState } from 'react';
import { listProjects } from '../api/projects';
import { PROJECT_STATUSES, type ProjectStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/badges';
import { ProjectList } from '../components/ProjectList';
import { RoleShell } from '../components/RoleShell';
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, Pagination, Select, Spinner } from '../components/ui';
import { describeError } from '../lib/errors';
import { STATUS_LABELS } from '../lib/labels';
import { ROLE_VIEWS } from '../lib/roleViews';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 10;

/**
 * One dashboard for every role. GET /projects is already scoped by the backend (admin: all;
 * researcher/student: own + collaborating; judge: assigned; investor: linked), so this page only
 * renders what comes back; what differs per role is copy, navigation and the extras in ROLE_VIEWS.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [offset, setOffset] = useState(0);

  const role = user?.role;
  const view = role ? ROLE_VIEWS[role] : null;

  const list = useAsync(
    () => listProjects({ status: status || undefined, limit: PAGE_SIZE, offset }),
    [status, offset],
  );
  const counts = useAsync(async () => {
    if (!view?.showStatusCounts) return undefined;
    // No stats endpoint: one cheap query per status (limit=1) and read `total`.
    const pages = await Promise.all(PROJECT_STATUSES.map((s) => listProjects({ status: s, limit: 1 })));
    return Object.fromEntries(PROJECT_STATUSES.map((s, i) => [s, pages[i].total])) as Record<ProjectStatus, number>;
  }, [view?.showStatusCounts]);

  if (!user || !view) return null;

  const page = list.data;
  const filtered = status !== '';

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title={view.dashboardTitle}
          description={`Hola, ${user.fullName.split(' ')[0]}. ${view.dashboardIntro}`}
          actions={view.canCreate && <ButtonLink to="/projects/new">Nuevo proyecto</ButtonLink>}
        />

        {view.showStatusCounts && (
          <Card title="Proyectos por estado">
            {counts.error ? (
              <Alert tone="error">{describeError(counts.error)}</Alert>
            ) : !counts.data ? (
              <Spinner label="Calculando conteos..." />
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Conteo por estado">
                {PROJECT_STATUSES.map((s) => (
                  <div key={s} className="rounded-xl border border-slate-100 bg-gradient-to-br from-brand-50 to-white px-3 py-3">
                    <dt className="text-xs text-slate-600">
                      <StatusBadge status={s} />
                    </dt>
                    <dd className="mt-1 text-3xl font-bold text-brand-700" data-testid={`count-${s}`}>
                      {counts.data?.[s] ?? 0}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        )}

        {view.showStatusCounts && (
          <div className="max-w-xs">
            <Select
              label="Filtrar por estado"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ProjectStatus | '');
                setOffset(0);
              }}
            >
              <option value="">Todos los estados</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        )}

        <section aria-label="Lista de proyectos" aria-busy={list.loading} className="space-y-4">
          {list.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(list.error)}</Alert>
              <Button variant="secondary" onClick={list.reload}>
                Reintentar
              </Button>
            </div>
          ) : !page ? (
            <Spinner label="Cargando proyectos..." />
          ) : page.data.length === 0 ? (
            filtered ? (
              <EmptyState
                title="No hay proyectos con ese estado"
                description="Prueba con otro estado o quita el filtro."
              />
            ) : (
              <EmptyState title={view.emptyTitle} description={view.emptyDescription} />
            )
          ) : (
            <>
              <p className="sr-only" role="status">
                {page.total} proyecto{page.total === 1 ? '' : 's'}
              </p>
              <ProjectList projects={page.data} currentUserId={user.id} />
              <Pagination
                total={page.total}
                limit={page.limit}
                offset={page.offset}
                disabled={list.loading}
                onChange={setOffset}
              />
            </>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
