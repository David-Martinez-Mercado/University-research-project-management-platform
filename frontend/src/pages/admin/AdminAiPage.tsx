import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listAiInteractions } from '../../api/ai';
import { RoleShell } from '../../components/RoleShell';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Pagination, Spinner } from '../../components/ui';
import { describeError } from '../../lib/errors';
import { formatDateTime } from '../../lib/labels';
import { useAsync } from '../../lib/useAsync';

const PAGE_SIZE = 10;

/** AI interaction log for quality review (AIR-005, AIR-007). Administrators only. */
export function AdminAiPage() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const log = useAsync(
    () => listAiInteractions({ flagged: flaggedOnly ? true : undefined, limit: PAGE_SIZE, offset }),
    [flaggedOnly, offset],
  );
  const page = log.data;

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Actividad del asistente de IA"
          description="Revisa las preguntas y respuestas del asistente. Las respuestas reportadas como incorrectas aparecen marcadas."
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={flaggedOnly}
            onChange={(e) => {
              setFlaggedOnly(e.target.checked);
              setOffset(0);
            }}
          />
          Mostrar solo respuestas reportadas
        </label>

        <section aria-label="Interacciones" aria-busy={log.loading}>
          {log.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(log.error)}</Alert>
              <Button variant="secondary" onClick={log.reload}>
                Reintentar
              </Button>
            </div>
          ) : !page ? (
            <Spinner label="Cargando interacciones..." />
          ) : page.data.length === 0 ? (
            <EmptyState
              title={flaggedOnly ? 'No hay respuestas reportadas' : 'Aún no hay interacciones'}
              description="Aparecerán aquí cuando los usuarios usen el asistente."
            />
          ) : (
            <div className="space-y-4">
              <ul className="space-y-3">
                {page.data.map((i) => (
                  <li key={i.id}>
                    <Card className={i.flagged ? 'border-l-4 border-l-red-500' : ''}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-words font-semibold">{i.question}</p>
                        <div className="flex flex-wrap gap-2">
                          {i.flagged && <Badge tone="danger">Reportada</Badge>}
                          {i.fallback && <Badge tone="warning">Sin información relevante</Badge>}
                        </div>
                      </div>
                      {i.answer && <p className="mt-2 line-clamp-4 break-words text-sm text-slate-700">{i.answer}</p>}
                      <p className="mt-2 text-xs text-slate-500">
                        {i.user} ·{' '}
                        {i.project ? (
                          <Link to={`/projects/${i.project.id}`} className="text-brand-700 hover:underline">
                            {i.project.title}
                          </Link>
                        ) : (
                          'proyecto eliminado'
                        )}{' '}
                        · {formatDateTime(i.createdAt)}
                        {i.confidence !== null && ` · similitud ${Math.round(i.confidence * 100) / 100}`}
                        {i.latencyMs !== null && ` · ${i.latencyMs} ms`}
                        {i.model && ` · ${i.model}`}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination total={page.total} limit={page.limit} offset={page.offset} disabled={log.loading} onChange={setOffset} />
            </div>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
