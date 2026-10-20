import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { getStorage } from '../documents/storage';
import { chunkSegments, type Chunk } from './chunker';
import { assertValidEmbeddings, EMBEDDING_DIMENSIONS, EmbeddingError, getEmbeddingProvider } from './embeddings';
import { ExtractionError, extractText } from './extract';
import { aiLog } from './log';
import { toVectorLiteral } from './vector';

export interface IngestionResult {
  documentId: string;
  status: 'READY' | 'FAILED' | 'NOT_FOUND';
  chunkCount: number;
  /** Short, non-sensitive machine-readable reason when status is FAILED. Never contains file text. */
  reason?: string;
}

const INSERT_BATCH = 100;

/** Maps any error to a short reason that is safe to log (no file content, no secrets). */
export function describeFailure(err: unknown): string {
  if (err instanceof ExtractionError) return `extraction:${err.code}`;
  if (err instanceof EmbeddingError) return `embedding:${err.message}`.slice(0, 200);
  const e = err as { code?: unknown; name?: unknown } | null;
  if (e && typeof e.code === 'string') {
    if (e.code === 'ENOENT') return 'storage:file_not_found';
    return `error:${e.code}`;
  }
  return `error:${typeof e?.name === 'string' ? e.name : 'unknown'}`;
}

class StorageReadError extends Error {
  constructor(readonly cause: unknown) {
    super('storage read failed');
  }
}

// Ingestions of the SAME document run one after another (a re-upload or retry never interleaves with a run
// in progress); different documents run concurrently.
const queues = new Map<string, Promise<unknown>>();

export function ingestDocument(documentId: string): Promise<IngestionResult> {
  const previous = queues.get(documentId) ?? Promise.resolve();
  const run = previous.then(() => runIngestion(documentId));
  const tail = run.catch(() => undefined);
  queues.set(documentId, tail);
  void tail.then(() => {
    if (queues.get(documentId) === tail) queues.delete(documentId);
  });
  return run;
}

async function runIngestion(documentId: string): Promise<IngestionResult> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, storageKey: true, mimeType: true, fileName: true },
  });
  if (!doc) {
    aiLog.warn('ingestion skipped: document not found', { documentId });
    return { documentId, status: 'NOT_FOUND', chunkCount: 0 };
  }

  try {
    await prisma.document.update({ where: { id: documentId }, data: { ingestionStatus: 'PROCESSING' } });

    let bytes: Buffer;
    try {
      bytes = await getStorage().read(doc.storageKey);
    } catch (err) {
      throw new StorageReadError(err);
    }

    const segments = await extractText(bytes, { mimeType: doc.mimeType, fileName: doc.fileName });
    const chunks = chunkSegments(segments);
    if (chunks.length === 0) throw new ExtractionError('EMPTY', 'Document produced no chunks');

    const vectors = await embedAll(chunks);
    await replaceChunks(documentId, chunks, vectors);

    aiLog.info('ingestion finished', { documentId, chunks: chunks.length });
    return { documentId, status: 'READY', chunkCount: chunks.length };
  } catch (err) {
    const reason = err instanceof StorageReadError ? describeFailure(err.cause) : describeFailure(err);
    const finalReason = err instanceof StorageReadError && !reason.startsWith('storage:') ? `storage:${reason}` : reason;
    aiLog.error('ingestion failed', { documentId, reason: finalReason });
    await markFailed(documentId);
    return { documentId, status: 'FAILED', chunkCount: 0, reason: finalReason };
  }
}

/** Embeds chunk contents in slices of EMBEDDING_BATCH_SIZE and returns ready-to-bind pgvector literals. */
async function embedAll(chunks: Chunk[]): Promise<string[]> {
  const provider = getEmbeddingProvider();
  const literals: string[] = [];
  const size = env.EMBEDDING_BATCH_SIZE;
  for (let i = 0; i < chunks.length; i += size) {
    const slice = chunks.slice(i, i + size);
    const vectors = await provider.embed(slice.map((c) => c.content));
    // Validated here as well, so a misbehaving custom provider can never reach the vector(1536) column.
    assertValidEmbeddings(vectors, slice.length, EMBEDDING_DIMENSIONS);
    for (const v of vectors) literals.push(toVectorLiteral(v));
  }
  return literals;
}

/** Atomically swaps a document's chunks and marks it READY. All values are bound parameters. */
async function replaceChunks(documentId: string, chunks: Chunk[], vectors: string[]): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId } });
      for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
        const batch = chunks.slice(i, i + INSERT_BATCH);
        const vecs = vectors.slice(i, i + INSERT_BATCH);
        await tx.$executeRaw`
          INSERT INTO document_chunks (id, document_id, chunk_index, content, page_number, token_count, embedding_vector)
          SELECT gen_random_uuid(), ${documentId}::uuid, t.chunk_index, t.content, t.page_number, t.token_count, t.vec::vector
          FROM unnest(
            ${batch.map((c) => c.chunkIndex)}::int[],
            ${batch.map((c) => c.content)}::text[],
            ${batch.map((c) => c.pageNumber)}::int[],
            ${batch.map((c) => c.tokenCount)}::int[],
            ${vecs}::text[]
          ) AS t(chunk_index, content, page_number, token_count, vec)`;
      }
      await tx.document.update({ where: { id: documentId }, data: { ingestionStatus: 'READY' } });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/** FAILED documents never keep chunks (no partial or stale data is searchable). Never throws. */
async function markFailed(documentId: string): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId } }),
      prisma.document.updateMany({ where: { id: documentId }, data: { ingestionStatus: 'FAILED' } }),
    ]);
  } catch (err) {
    aiLog.error('could not mark document as FAILED', { documentId, reason: describeFailure(err) });
  }
}
