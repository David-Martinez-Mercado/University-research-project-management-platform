import { useState } from 'react';
import { getResults } from '../../api/evaluations';
import { downloadProjectReport } from '../../api/investors';
import { describeError } from '../../lib/errors';
import { saveBlob } from '../../lib/saveBlob';
import { useAsync } from '../../lib/useAsync';
import { Alert, Button, Card, EmptyState, ProgressBar, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

const REPORT_ROLES = ['ADMINISTRATOR', 'INVESTOR', 'JUDGE'];

/**
 * Evaluation results. Until the evaluation closes the backend returns `results: null` for everyone except
 * administrators (BR-003), so this tab only renders what it is given.
 */
export function ResultsTab({ project, role }: WorkspaceContext) {
  const results = useAsync(() => getResults(project.id), [project.id, project.status]);
  const [downloading, setDownloading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function download() {
    setReportError(null);
    setDownloading(true);
    try {
      saveBlob(await downloadProjectReport(project.id), `reporte-${project.title.slice(0, 40)}.pdf`);
    } catch (err) {
      setReportError(describeError(err, 'report'));
    } finally {
      setDownloading(false);
    }
  }

  if (results.error && !results.data) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{describeError(results.error)}</Alert>
        <Button variant="secondary" onClick={results.reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!results.data) return <Spinner label="Cargando resultados..." />;

  const r = results.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Jueces asignados: <strong>{r.judgesAssigned}</strong> · Evaluaciones enviadas: <strong>{r.judgesCompleted}</strong>
        </p>
        {REPORT_ROLES.includes(role) && (
          <Button variant="secondary" loading={downloading} onClick={() => void download()}>
            Descargar reporte PDF
          </Button>
        )}
      </div>
      {reportError && (
        <Alert tone="error">
          {reportError}{' '}
          <button type="button" className="font-medium underline" onClick={() => void download()}>
            Reintentar
          </button>
        </Alert>
      )}

      {!r.results ? (
        <EmptyState
          title="Los resultados aún no están disponibles"
          description="Se publicarán cuando todos los jueces envíen su evaluación y finalice el periodo de evaluación."
        />
      ) : r.results.criteria.length === 0 ? (
        <EmptyState title="Todavía no hay evaluaciones enviadas" description="Aparecerán aquí en cuanto los jueces envíen las suyas." />
      ) : (
        <>
          {!r.closed && <Alert tone="info">Vista previa de administrador: el periodo de evaluación sigue abierto.</Alert>}
          {r.results.overallPercent !== null && (
            <Card>
              <ProgressBar value={r.results.overallPercent} label="Calificación global ponderada" />
            </Card>
          )}
          <ul className="space-y-3">
            {r.results.criteria.map((c) => (
              <li key={c.criterionId}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{c.name}</h3>
                    <p className="text-sm text-slate-600">
                      Promedio <strong className="text-brand-700">{c.average ?? '—'}</strong> / {c.maxScore} · peso {c.weight}
                    </p>
                  </div>
                  {c.comments.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {c.comments.map((cm, i) => (
                        <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          {cm.judge && <span className="font-medium">{cm.judge}: </span>}
                          {cm.comment}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
