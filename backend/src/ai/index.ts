import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { DOCUMENT_UPLOADED, documentEvents, type DocumentUploadedEvent } from '../documents/documents.events';
import { ingestDocument } from './ingestion';
import { aiLog } from './log';

export { ingestDocument } from './ingestion';
export type { IngestionResult } from './ingestion';
export { searchChunks } from './search';
export type { ChunkHit } from './search';
export { getEmbeddingProvider } from './embeddings';

const inFlight = new Set<Promise<unknown>>();
let listener: ((event: DocumentUploadedEvent) => void) | undefined;

/** Resolves when every ingestion started by the event listener has finished (used by tests and graceful shutdown). */
export async function whenIngestionIdle(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/**
 * Subscribes ingestion to the documents module's `uploaded` event. Fire-and-forget: the upload request never
 * waits for, or fails because of, ingestion. Idempotent (calling it twice registers one listener).
 * Returns a function that unsubscribes. The server entry point (src/server.ts) is responsible for calling it.
 */
export function registerAiListeners(): () => void {
  if (!listener) {
    if (env.NODE_ENV === 'production' && env.EMBEDDING_PROVIDER === 'mock') {
      aiLog.warn('EMBEDDING_PROVIDER=mock in production: answers will not be semantically meaningful');
    }
    listener = (event) => {
      const task = ingestDocument(event.documentId)
        .catch((err: unknown) => {
          // ingestDocument handles its own failures; this is the last line of defence for the process.
          aiLog.error('unexpected ingestion crash', { documentId: event.documentId, reason: (err as Error)?.name });
        })
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    };
    documentEvents.on(DOCUMENT_UPLOADED, listener);
  }
  return unregisterAiListeners;
}

/**
 * Ingestion runs in-process, so a restart (or crash) mid-ingestion would leave documents stuck in
 * PENDING/PROCESSING forever. Call this once at startup to re-run them. Sequential on purpose (bounded
 * load on the embedding provider); ingestion is idempotent, so re-running a half-done document is safe.
 * Returns how many documents it attempted. Never throws.
 */
export async function recoverPendingIngestions(limit = 200): Promise<number> {
  let ids: { id: string }[];
  try {
    ids = await prisma.document.findMany({
      where: { ingestionStatus: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true },
      orderBy: { uploadedAt: 'asc' },
      take: limit,
    });
  } catch (err) {
    aiLog.error('could not list documents pending ingestion', { reason: (err as Error)?.name });
    return 0;
  }
  if (ids.length > 0) aiLog.info('recovering documents left unindexed', { count: ids.length });
  for (const { id } of ids) {
    const task = ingestDocument(id)
      .catch((err: unknown) => {
        aiLog.error('unexpected ingestion crash during recovery', { documentId: id, reason: (err as Error)?.name });
      })
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
    await task;
  }
  return ids.length;
}

export function unregisterAiListeners(): void {
  if (listener) {
    documentEvents.off(DOCUMENT_UPLOADED, listener);
    listener = undefined;
  }
}
