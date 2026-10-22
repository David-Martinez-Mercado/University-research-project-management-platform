import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askAssistant, flagAnswer, listAiHistory } from '../../api/ai';
import type { AiExchange } from '../../api/types';
import { describeError } from '../../lib/errors';
import { useAsync } from '../../lib/useAsync';
import { Alert, Badge, Button, EmptyState, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

/**
 * Assistant grounded in the project's own documents (FR-007, FR-008). Every answer is labeled "Generado por IA"
 * (AIR-009), cites the retrieved sources (AIR-003) and can be reported as incorrect (AIR-007). When the backend
 * finds nothing relevant it answers with a fallback message instead of an invented answer.
 */
export function AiTab({ project }: WorkspaceContext) {
  const history = useAsync(() => listAiHistory(project.id), [project.id]);
  const [pending, setPending] = useState<string | null>(null);
  const [extra, setExtra] = useState<AiExchange[]>([]);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const exchanges = [...(history.data ?? []), ...extra];
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [exchanges.length, pending]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 3) {
      setError('Escribe una pregunta de al menos 3 caracteres.');
      return;
    }
    setError(null);
    setPending(text);
    setQuestion('');
    try {
      const res = await askAssistant(project.id, text);
      setExtra((prev) => [
        ...prev,
        {
          interactionId: res.interactionId,
          question: text,
          answer: res.answer,
          message: res.message,
          fallback: res.fallback,
          flagged: false,
          sources: res.sources,
        },
      ]);
    } catch (err) {
      setQuestion(text); // let the user retry without retyping
      setError(describeError(err, 'ai-ask'));
    } finally {
      setPending(null);
    }
  }

  async function report(id: string) {
    setFlagError(null);
    try {
      await flagAnswer(id);
      setFlagged((prev) => new Set(prev).add(id));
    } catch (err) {
      setFlagError(describeError(err));
    }
  }

  if (history.error && !history.data) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{describeError(history.error)}</Alert>
        <Button variant="secondary" onClick={history.reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!history.data) return <Spinner label="Cargando conversación..." />;

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
        Pregunta lo que necesites sobre los documentos de este proyecto. El asistente solo usa esos documentos y cita sus fuentes;
        verifica siempre la respuesta antes de tomar decisiones.
      </p>

      <div
        className="max-h-[32rem] space-y-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        role="log"
        aria-label="Conversación con el asistente"
        aria-live="polite"
      >
        {exchanges.length === 0 && !pending && (
          <EmptyState
            title="Aún no has hecho preguntas"
            description="Prueba con «¿Cuál es el objetivo del proyecto?» o «¿Qué metodología se usa?». Primero sube documentos en la pestaña Documentos."
          />
        )}
        {exchanges.map((ex) => (
          <div key={ex.interactionId} className="space-y-2">
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white">
                {ex.question}
              </p>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm">
                {ex.fallback ? (
                  <p className="text-slate-800">
                    {ex.message ?? 'No se encontró información suficientemente relevante.'}{' '}
                    <span className="text-slate-600">Intenta reformular la pregunta o consulta al investigador responsable.</span>
                  </p>
                ) : (
                  <>
                    <Badge tone="info">Generado por IA</Badge>
                    <p className="whitespace-pre-wrap break-words text-slate-900">{ex.answer}</p>
                    {ex.sources.length > 0 && (
                      <details className="text-xs text-slate-600">
                        <summary className="cursor-pointer font-medium text-brand-700">
                          Fuentes ({ex.sources.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {ex.sources.map((s) => (
                            <li key={`${s.documentId}-${s.chunkIndex}`} className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                              <p className="font-medium text-slate-800">
                                {s.fileName}
                                {s.pageNumber ? ` · pág. ${s.pageNumber}` : ''}
                              </p>
                              <p className="mt-0.5 break-words">{s.excerpt}</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {flagged.has(ex.interactionId) || ex.flagged ? (
                      <p className="text-xs font-medium text-slate-600">Reportada como incorrecta. ¡Gracias!</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void report(ex.interactionId)}
                        className="text-xs font-medium text-accent-700 underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        Reportar respuesta incorrecta
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {pending && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <p className="max-w-[85%] break-words rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white">{pending}</p>
            </div>
            <Spinner label="El asistente está buscando en los documentos..." />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {flagError && <Alert tone="error">{flagError}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row" aria-label="Preguntar al asistente">
        <div className="flex-1">
          <label htmlFor="ai-question" className="sr-only">
            Tu pregunta
          </label>
          <textarea
            id="ai-question"
            rows={2}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Escribe tu pregunta sobre los documentos…"
            disabled={pending !== null}
            className="block w-full resize-none rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:bg-slate-100"
          />
        </div>
        <Button type="submit" loading={pending !== null} className="sm:self-stretch">
          Preguntar
        </Button>
      </form>
    </div>
  );
}
