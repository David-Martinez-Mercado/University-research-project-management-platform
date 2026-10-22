import { useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadProjectReport, getInvestorDashboard } from '../api/investors';
import { PROJECT_STATUSES, type InvestorProject, type ProjectStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/badges';
import { RoleShell } from '../components/RoleShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  ProgressBar,
  Select,
  Spinner,
} from '../components/ui';
import { describeError } from '../lib/errors';
import { formatDate, STATUS_LABELS } from '../lib/labels';
import { saveBlob } from '../lib/saveBlob';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 6;

interface Filters {
  status: ProjectStatus | '';
  researchArea: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { status: '', researchArea: '', from: '', to: '' };

function ProjectCard({ project, onReportError }: { project: InvestorProject; onReportError: (msg: string | null) => void }) {
  const [downloading, setDownloading] = useState(false);
  const ev = project.evaluation;
  const next = project.milestones.filter((m) => !m.completed).slice(0, 3);

  async function exportPdf() {
    onReportError(null);
    setDownloading(true);
    try {
      saveBlob(await downloadProjectReport(project.id), `reporte-${project.title.slice(0, 40)}.pdf`);
    } catch (err) {
      onReportError(`«${project.title}»: ${describeError(err, 'report')}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card className="flex h-full flex-col border-t-4 border-t-brand-500">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-base font-semibold">
          <Link to={`/projects/${project.id}`} className="text-brand-700 hover:underline">
            {project.title}
          </Link>
        </h3>
        <StatusBadge status={project.status} />
      </div>
      {project.summary && <p className="mt-1 line-clamp-2 break-words text-sm text-slate-600">{project.summary}</p>}
      <p className="mt-2 text-xs text-slate-500">
        {project.researchArea ?? 'Sin área'} · Responsable: {project.ownerName} · Actualizado {formatDate(project.updatedAt)}
      </p>

      <div className="mt-4 space-y-3">
        <ProgressBar value={project.progressPercent} label="Avance" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={ev.closed ? 'success' : 'neutral'}>
            Evaluación: {ev.judgesCompleted}/{ev.judgesAssigned} jueces
          </Badge>
          {ev.closed && ev.overallPercent !== null && (
            <span className="font-semibold text-brand-700">Calificación global {ev.overallPercent}%</span>
          )}
          {!ev.closed && <span className="text-xs text-slate-500">Resultados al cerrar la evaluación</span>}
        </div>
        {next.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Próximos hitos</p>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {next.map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">{m.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{m.dueDate ? formatDate(m.dueDate) : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button size="sm" variant="secondary" loading={downloading} onClick={() => void exportPdf()}>
          Exportar PDF
        </Button>
      </div>
    </Card>
  );
}

/** Read-only dashboard of the projects linked to the signed-in investor (FR-015, FR-016, FR-018, BR-007). */
export function InvestorDashboardPage() {
  const { user } = useAuth();
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [offset, setOffset] = useState(0);
  const [reportError, setReportError] = useState<string | null>(null);

  const dash = useAsync(
    () =>
      getInvestorDashboard(user!.id, {
        status: applied.status || undefined,
        researchArea: applied.researchArea || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [user?.id, applied, offset],
  );
  if (!user) return null;

  const data = dash.data;
  const filtered = JSON.stringify(applied) !== JSON.stringify(NO_FILTERS);
  const dateInvalid = !!draft.from && !!draft.to && draft.from > draft.to;

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Proyectos vinculados"
          description={`Hola, ${user.fullName.split(' ')[0]}. Sigue el avance y la evaluación de los proyectos que apoyas (solo lectura).`}
        />

        {data && (
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 px-4 py-3 text-white shadow-sm">
              <p className="text-xs text-brand-100">Total vinculados</p>
              <p className="text-3xl font-bold" data-testid="total-linked">
                {data.summary.totalLinked}
              </p>
            </div>
            {PROJECT_STATUSES.map((s) => (
              <div key={s} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-600">{STATUS_LABELS[s]}</p>
                <p className="text-3xl font-bold text-brand-700" data-testid={`inv-count-${s}`}>
                  {data.summary.byStatus[s] ?? 0}
                </p>
              </div>
            ))}
          </section>
        )}

        <form
          aria-label="Filtros"
          className="grid items-end gap-x-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (dateInvalid) return;
            setOffset(0);
            setApplied(draft);
          }}
        >
          <Select label="Estado" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus | '' })}>
            <option value="">Todos</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select label="Área de investigación" value={draft.researchArea} onChange={(e) => setDraft({ ...draft, researchArea: e.target.value })}>
            <option value="">Todas</option>
            {data?.summary.researchAreas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Input label="Registrados desde" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <Input
            label="Hasta"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            error={dateInvalid ? 'La fecha final debe ser posterior a la inicial.' : undefined}
          />
          <div className="flex gap-2 pb-5">
            <Button type="submit">Filtrar</Button>
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(NO_FILTERS);
                  setApplied(NO_FILTERS);
                  setOffset(0);
                }}
              >
                Limpiar
              </Button>
            )}
          </div>
        </form>

        {reportError && <Alert tone="error">{reportError}</Alert>}

        <section aria-label="Proyectos vinculados" aria-busy={dash.loading}>
          {dash.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(dash.error)}</Alert>
              <Button variant="secondary" onClick={dash.reload}>
                Reintentar
              </Button>
            </div>
          ) : !data ? (
            <Spinner label="Cargando proyectos..." />
          ) : data.data.length === 0 ? (
            filtered ? (
              <EmptyState title="No hay proyectos con esos filtros" description="Prueba con otros criterios o limpia los filtros." />
            ) : (
              <EmptyState
                title="Aún no hay proyectos vinculados"
                description="Los reportes aparecerán cuando un administrador vincule proyectos a tu cuenta y se registre su avance."
              />
            )
          ) : (
            <div className="space-y-4">
              <p className="sr-only" role="status">
                {data.total} proyecto{data.total === 1 ? '' : 's'}
              </p>
              <ul className="grid gap-4 md:grid-cols-2">
                {data.data.map((p) => (
                  <li key={p.id}>
                    <ProjectCard project={p} onReportError={setReportError} />
                  </li>
                ))}
              </ul>
              <Pagination total={data.total} limit={data.limit} offset={data.offset} disabled={dash.loading} onChange={setOffset} />
            </div>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
