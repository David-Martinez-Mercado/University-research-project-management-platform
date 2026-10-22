import { getRubric } from '../../api/criteria';
import { describeError } from '../../lib/errors';
import { useAsync } from '../../lib/useAsync';
import { Alert, Button, EmptyState, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

/** Read-only view of the active rubric (GET /projects/:id/rubric). Scoring lives in the evaluation module. */
export function RubricTab({ project, role }: WorkspaceContext) {
  const rubric = useAsync(() => getRubric(project.id), [project.id]);

  if (rubric.error) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{describeError(rubric.error)}</Alert>
        <Button variant="secondary" onClick={rubric.reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!rubric.data) return <Spinner label="Cargando rúbrica..." />;
  if (rubric.data.length === 0) {
    return (
      <EmptyState
        title="Aún no hay criterios activos"
        description={
          role === 'ADMINISTRATOR'
            ? 'Define los criterios en el menú «Criterios».'
            : 'Un administrador debe definir la rúbrica de evaluación.'
        }
      />
    );
  }

  const totalWeight = rubric.data.reduce((sum, c) => sum + c.weight, 0);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Estos son los criterios con los que se evalúa el proyecto. Peso total: <strong>{Math.round(totalWeight * 100) / 100}</strong>.
      </p>
      <ol className="space-y-3">
        {rubric.data.map((c, i) => (
          <li key={c.id} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="break-words font-semibold">{c.name}</p>
              {c.description && <p className="mt-0.5 break-words text-sm text-slate-600">{c.description}</p>}
              <p className="mt-1 text-xs text-slate-500">
                Puntaje máximo {c.maxScore} · Peso {c.weight}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
