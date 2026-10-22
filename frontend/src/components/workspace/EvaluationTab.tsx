import { useEffect, useState } from 'react';
import { getMyEvaluation, saveEvaluation } from '../../api/evaluations';
import type { MyEvaluation } from '../../api/types';
import { describeError } from '../../lib/errors';
import { STATUS_LABELS } from '../../lib/labels';
import { useAsync } from '../../lib/useAsync';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

interface Row {
  score: string;
  comments: string;
}

const toRows = (ev: MyEvaluation): Record<string, Row> =>
  Object.fromEntries(ev.criteria.map((c) => [c.criterionId, { score: c.score === null ? '' : String(c.score), comments: c.comments ?? '' }]));

/**
 * Judge scoring against the rubric (FR-012, UC-004). A draft survives a closed tab (FR-029): the form is rebuilt
 * from what the server stored. The backend re-checks assignment, conflict of interest and project state on every call.
 */
export function EvaluationTab({ project }: WorkspaceContext) {
  const evaluation = useAsync(() => getMyEvaluation(project.id), [project.id, project.status]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ev = evaluation.data;
  useEffect(() => {
    if (ev) setRows(toRows(ev));
  }, [ev]);

  if (evaluation.error && !ev) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{describeError(evaluation.error, 'evaluation-save')}</Alert>
        <Button variant="secondary" onClick={evaluation.reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!ev) return <Spinner label="Cargando tu evaluación..." />;

  if (ev.criteria.length === 0) {
    return (
      <EmptyState
        title="Aún no hay criterios de evaluación"
        description="Un administrador debe definir la rúbrica antes de que puedas calificar."
      />
    );
  }

  const editable = ev.canEdit;
  const submitted = ev.state === 'SUBMITTED';

  function validate(forSubmit: boolean): boolean {
    const next: Record<string, string> = {};
    for (const c of ev!.criteria) {
      const raw = rows[c.criterionId]?.score ?? '';
      if (raw === '') {
        if (forSubmit) next[c.criterionId] = 'Ingresa una calificación.';
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > c.maxScore) next[c.criterionId] = `Debe estar entre 0 y ${c.maxScore}.`;
      else if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) next[c.criterionId] = 'Máximo 2 decimales.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save(submit: boolean) {
    setError(null);
    setNotice(null);
    if (!validate(submit)) {
      setConfirming(false);
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    try {
      const result = await saveEvaluation(
        project.id,
        ev!.criteria.map((c) => {
          const row = rows[c.criterionId] ?? { score: '', comments: '' };
          return {
            criterionId: c.criterionId,
            score: row.score === '' ? null : Number(row.score),
            comments: row.comments.trim() || null,
          };
        }),
        submit,
      );
      evaluation.setData(result);
      setConfirming(false);
      setNotice(
        submit
          ? result.projectClosed
            ? 'Evaluación enviada. Eras el último juez: el proyecto quedó como Evaluado.'
            : 'Evaluación enviada. ¡Gracias!'
          : 'Borrador guardado. Puedes volver y continuar cuando quieras.',
      );
    } catch (err) {
      setConfirming(false);
      setError(describeError(err, 'evaluation-save'));
    } finally {
      setBusy(null);
    }
  }

  const totalWeight = ev.criteria.reduce((s, c) => s + c.weight, 0);
  const preview = ev.criteria.every((c) => (rows[c.criterionId]?.score ?? '') !== '' && Number.isFinite(Number(rows[c.criterionId]?.score)))
    ? Math.round((ev.criteria.reduce((s, c) => s + (c.weight * Number(rows[c.criterionId]!.score)) / c.maxScore, 0) / totalWeight) * 1000) / 10
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={submitted ? 'success' : ev.state === 'DRAFT' ? 'warning' : 'neutral'}>
          {submitted ? 'Evaluación enviada' : ev.state === 'DRAFT' ? 'Borrador guardado' : 'Sin empezar'}
        </Badge>
      </div>

      {submitted && <Alert tone="success">Ya enviaste tu evaluación; no se puede modificar. Gracias por tu trabajo.</Alert>}
      {!submitted && !editable && (
        <Alert tone="info">
          Aún no puedes calificar: el proyecto está <strong>{STATUS_LABELS[ev.project.status]}</strong>. Podrás hacerlo cuando un
          administrador inicie la evaluación.
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validate(true)) setConfirming(true);
        }}
        noValidate
        aria-label="Formulario de evaluación"
        className="space-y-4"
      >
        {ev.criteria.map((c, i) => {
          const row = rows[c.criterionId] ?? { score: '', comments: '' };
          const err = errors[c.criterionId];
          const scoreId = `score-${c.criterionId}`;
          return (
            <Card key={c.criterionId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">
                    <span className="mr-2 text-slate-400">{i + 1}.</span>
                    {c.name}
                  </h3>
                  {c.description && <p className="mt-0.5 text-sm text-slate-600">{c.description}</p>}
                  <p className="mt-1 text-xs text-slate-500">Peso {c.weight}</p>
                </div>
                <div className="w-36">
                  <label htmlFor={scoreId} className="block text-sm font-medium text-slate-800">
                    Calificación (0–{c.maxScore})
                  </label>
                  <input
                    id={scoreId}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={c.maxScore}
                    step="0.5"
                    value={row.score}
                    disabled={!editable || busy !== null}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${scoreId}-err` : undefined}
                    onChange={(e) => setRows((r) => ({ ...r, [c.criterionId]: { ...row, score: e.target.value } }))}
                    className={`mt-1 block w-full rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-brand-600 disabled:bg-slate-100 ${err ? 'ring-red-500' : 'ring-slate-300'}`}
                  />
                  <p id={`${scoreId}-err`} className="min-h-4 text-xs font-medium text-red-700">
                    {err}
                  </p>
                </div>
              </div>
              <label htmlFor={`comments-${c.criterionId}`} className="mt-2 block text-sm font-medium text-slate-800">
                Comentarios (opcional)
              </label>
              <textarea
                id={`comments-${c.criterionId}`}
                rows={2}
                maxLength={2000}
                value={row.comments}
                disabled={!editable || busy !== null}
                onChange={(e) => setRows((r) => ({ ...r, [c.criterionId]: { ...row, comments: e.target.value } }))}
                className="mt-1 block w-full rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:bg-slate-100"
              />
            </Card>
          );
        })}

        {preview !== null && (
          <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
            Calificación ponderada resultante: <strong>{preview}%</strong>
          </p>
        )}

        {editable && !confirming && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === 'draft'} disabled={busy !== null} onClick={() => void save(false)}>
              Guardar borrador
            </Button>
            <Button type="submit" disabled={busy !== null}>
              Enviar evaluación
            </Button>
          </div>
        )}

        {editable && confirming && (
          <Alert tone="info">
            <p className="font-medium">¿Enviar tu evaluación definitiva?</p>
            <p className="mt-1">Una vez enviada ya no podrás modificarla.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button loading={busy === 'submit'} onClick={() => void save(true)}>
                Sí, enviar
              </Button>
              <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirming(false)}>
                Seguir editando
              </Button>
            </div>
          </Alert>
        )}
      </form>
    </div>
  );
}
