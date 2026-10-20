import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAiListeners, unregisterAiListeners, whenIngestionIdle } from '../src/ai';
import { EMBEDDING_DIMENSIONS, MockEmbeddingProvider, setEmbeddingProviderForTests, type EmbeddingProvider } from '../src/ai/embeddings';
import { env } from '../src/config/env';
import { ingestDocument } from '../src/ai/ingestion';
import { prisma } from '../src/db/prisma';
import { emitDocumentUploaded } from '../src/documents/documents.events';
import { setStorageForTests } from '../src/documents/storage';
import { buildDocx, buildPdf, makeDocument, makeOwner, makeProject, MIME, resetAiDb, TempDirStorage } from './ai-helpers';

let storage: TempDirStorage;

beforeAll(async () => {
  storage = await TempDirStorage.create();
  setStorageForTests(storage);
  registerAiListeners();
});

afterAll(async () => {
  unregisterAiListeners();
  setStorageForTests(undefined);
  setEmbeddingProviderForTests(undefined);
  await storage.dispose();
  await prisma.$disconnect();
});

beforeEach(async () => {
  setEmbeddingProviderForTests(new MockEmbeddingProvider());
  await resetAiDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const owner = await makeOwner();
  const project = await makeProject(owner.id);
  const upload = async (fileName: string, mimeType: string, data: Buffer) =>
    makeDocument({ storage, projectId: project.id, uploadedById: owner.id, fileName, mimeType, data });
  return { owner, project, upload };
}

/** Emits the upload event exactly like the documents module does, then waits for the async listener. */
async function emitAndWait(doc: { id: string; projectId: string }) {
  emitDocumentUploaded({ documentId: doc.id, projectId: doc.projectId });
  await whenIngestionIdle();
}

const getDoc = (id: string) => prisma.document.findUniqueOrThrow({ where: { id } });
const getChunks = (documentId: string) =>
  prisma.$queryRaw<
    { id: string; chunk_index: number; content: string; page_number: number | null; token_count: number; dims: number }[]
  >`SELECT id, chunk_index, content, page_number, token_count, vector_dims(embedding_vector) AS dims
    FROM document_chunks WHERE document_id = ${documentId}::uuid ORDER BY chunk_index`;

const sentences = (n: number, topic: string) =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} about ${topic} describes the measured behaviour in detail.`).join(' ');

describe('ingestion via the uploaded event (end to end, real DB)', () => {
  it('TXT: PENDING -> READY with sequential, embedded chunks', async () => {
    const { upload } = await setup();
    const doc = await upload('notes.txt', MIME.txt, Buffer.from(sentences(60, 'quantum sensors'), 'utf8'));
    expect((await getDoc(doc.id)).ingestionStatus).toBe('PENDING');

    await emitAndWait(doc);

    expect((await getDoc(doc.id)).ingestionStatus).toBe('READY');
    const chunks = await getChunks(doc.id);
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((c, i) => {
      expect(c.chunk_index).toBe(i);
      expect(c.dims).toBe(EMBEDDING_DIMENSIONS);
      expect(c.page_number).toBeNull();
      expect(c.token_count).toBe(Math.ceil(c.content.length / 4));
      expect(c.content.length).toBeLessThanOrEqual(1000);
    });
  });

  it('MD with accents and unicode is stored verbatim', async () => {
    const { upload } = await setup();
    const text = '# Investigación\n\nLa señalización cuántica del niño en piña 😀 funciona.';
    const doc = await upload('a.md', MIME.md, Buffer.from(text, 'utf8'));
    await emitAndWait(doc);
    const chunks = await getChunks(doc.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('# Investigación\n\nLa señalización cuántica del niño en piña 😀 funciona.');
  });

  it('DOCX: extracts and ingests', async () => {
    const { upload } = await setup();
    const doc = await upload('p.docx', MIME.docx, await buildDocx(['Resumen del proyecto de energía solar.', 'Metodología y resultados.']));
    await emitAndWait(doc);
    expect((await getDoc(doc.id)).ingestionStatus).toBe('READY');
    const chunks = await getChunks(doc.id);
    expect(chunks[0]!.content).toContain('energía solar');
    expect(chunks[0]!.page_number).toBeNull();
  });

  it('PDF: keeps page numbers on chunks', async () => {
    const { upload } = await setup();
    const doc = await upload('p.pdf', MIME.pdf, buildPdf(['Introduction to graphene batteries', 'Results of the cycling test', 'Conclusions and future work']));
    await emitAndWait(doc);
    expect((await getDoc(doc.id)).ingestionStatus).toBe('READY');
    const chunks = await getChunks(doc.id);
    expect(chunks.map((c) => c.page_number)).toEqual([1, 2, 3]);
    expect(chunks[1]!.content).toContain('cycling test');
  });

  it('a large document (more chunks than one insert batch) is ingested completely', async () => {
    const { upload } = await setup();
    const doc = await upload('big.txt', MIME.txt, Buffer.from(sentences(2500, 'large corpus'), 'utf8'));
    const result = await ingestDocument(doc.id);
    expect(result.status).toBe('READY');
    expect(result.chunkCount).toBeGreaterThan(150);
    const chunks = await getChunks(doc.id);
    expect(chunks).toHaveLength(result.chunkCount);
    expect(new Set(chunks.map((c) => c.chunk_index)).size).toBe(chunks.length);
  });

  it('stores hostile text safely (quotes, SQL, $-placeholders, backslashes) via bound parameters', async () => {
    const { upload } = await setup();
    const evil = `Robert'); DROP TABLE documents; -- "quotes" $1 $$ back\\slash and \u001b control char. Fin.`;
    const doc = await upload('evil.txt', MIME.txt, Buffer.from(evil, 'utf8'));
    await emitAndWait(doc);
    expect((await getDoc(doc.id)).ingestionStatus).toBe('READY');
    const [chunk] = await getChunks(doc.id);
    expect(chunk!.content).toBe(`Robert'); DROP TABLE documents; -- "quotes" $1 $$ back\\slash and control char. Fin.`);
    expect(await prisma.document.count()).toBe(1);
  });

  it('is registered once: two registerAiListeners() calls still ingest a document once', async () => {
    registerAiListeners();
    registerAiListeners();
    const embed = vi.spyOn(MockEmbeddingProvider.prototype, 'embed');
    const { upload } = await setup();
    const doc = await upload('a.txt', MIME.txt, Buffer.from('Short text about solar panels.'));
    await emitAndWait(doc);
    expect(embed).toHaveBeenCalledTimes(1);
  });
});

describe('failure handling (FAILED, no chunks, no crash)', () => {
  it.each([
    ['corrupt PDF', 'bad.pdf', MIME.pdf, () => Buffer.from('%PDF-1.4 this is broken'), 'extraction:CORRUPT'],
    ['encrypted PDF', 'enc.pdf', MIME.pdf, () => buildPdf(['secret'], { encrypted: true }), 'extraction:ENCRYPTED'],
    ['scanned (textless) PDF', 'scan.pdf', MIME.pdf, () => buildPdf(['', '']), 'extraction:EMPTY'],
    ['empty TXT', 'empty.txt', MIME.txt, () => Buffer.alloc(0), 'extraction:EMPTY'],
    ['binary as TXT', 'bin.txt', MIME.txt, () => Buffer.from([0, 1, 2, 3, 0, 0]), 'extraction:CORRUPT'],
    ['truncated DOCX', 'bad.docx', MIME.docx, () => Buffer.from('PK\u0003\u0004 not really'), 'extraction:CORRUPT'],
    ['unsupported type', 'pic.png', 'image/png', () => Buffer.from('x'), 'extraction:UNSUPPORTED_TYPE'],
  ])('%s', async (_name, fileName, mime, make, reason) => {
    const { upload } = await setup();
    const doc = await upload(fileName, mime, make());
    // Emitting must not throw into the "upload request", and the process must survive.
    expect(() => emitDocumentUploaded({ documentId: doc.id, projectId: doc.projectId })).not.toThrow();
    await whenIngestionIdle();
    expect((await getDoc(doc.id)).ingestionStatus).toBe('FAILED');
    expect(await getChunks(doc.id)).toHaveLength(0);
    expect((await ingestDocument(doc.id)).reason).toBe(reason);
  });

  it('missing file in storage -> FAILED', async () => {
    const { upload } = await setup();
    const doc = await upload('gone.txt', MIME.txt, Buffer.from('hello there'));
    await storage.remove(doc.storageKey);
    const result = await ingestDocument(doc.id);
    expect(result).toMatchObject({ status: 'FAILED', reason: 'storage:file_not_found' });
    expect((await getDoc(doc.id)).ingestionStatus).toBe('FAILED');
  });

  it('unknown document id: NOT_FOUND result, no throw, listener survives', async () => {
    expect(await ingestDocument(randomUUID())).toMatchObject({ status: 'NOT_FOUND', chunkCount: 0 });
    emitDocumentUploaded({ documentId: randomUUID(), projectId: randomUUID() });
    await whenIngestionIdle();
  });

  it('an embedding provider that fails mid-document leaves NO partial chunks', async () => {
    const { upload } = await setup();
    const saved = env.EMBEDDING_BATCH_SIZE;
    env.EMBEDDING_BATCH_SIZE = 2;
    try {
      let calls = 0;
      const flaky: EmbeddingProvider = {
        dimensions: EMBEDDING_DIMENSIONS,
        embed: async (texts) => {
          if (++calls === 2) throw new Error('provider exploded with SECRET-TEXT');
          return new MockEmbeddingProvider().embed(texts);
        },
      };
      setEmbeddingProviderForTests(flaky);
      const doc = await upload('flaky.txt', MIME.txt, Buffer.from(sentences(40, 'flaky provider'), 'utf8'));
      const result = await ingestDocument(doc.id);
      expect(calls).toBe(2);
      expect(result.status).toBe('FAILED');
      expect(result.reason).not.toContain('SECRET-TEXT'); // raw error messages are not echoed
      expect(await getChunks(doc.id)).toHaveLength(0);
      expect((await getDoc(doc.id)).ingestionStatus).toBe('FAILED');
    } finally {
      env.EMBEDDING_BATCH_SIZE = saved;
    }
  });

  it('a provider returning the wrong dimension fails the document before touching the DB column', async () => {
    const { upload } = await setup();
    setEmbeddingProviderForTests({ dimensions: 8, embed: async (t) => t.map(() => new Array(8).fill(0.1)) });
    const doc = await upload('a.txt', MIME.txt, Buffer.from('some text to embed'));
    const result = await ingestDocument(doc.id);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toMatch(/^embedding:.*8 dimensions, expected 1536/);
    expect(await getChunks(doc.id)).toHaveLength(0);
  });

  it('a database error while swapping chunks -> FAILED and the stale chunks of the previous run are removed', async () => {
    const { upload } = await setup();
    const doc = await upload('a.txt', MIME.txt, Buffer.from('Text that will be ingested twice.'));
    expect((await ingestDocument(doc.id)).status).toBe('READY');
    expect(await getChunks(doc.id)).toHaveLength(1);
    // First $transaction call is the chunk swap; the second (markFailed) uses the real implementation.
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'P1001' }) as never);
    const result = await ingestDocument(doc.id);
    expect(result).toMatchObject({ status: 'FAILED', reason: 'error:P1001' });
    expect(await getChunks(doc.id)).toHaveLength(0);
    expect((await getDoc(doc.id)).ingestionStatus).toBe('FAILED');
  });
});

describe('idempotency and isolation', () => {
  it('re-ingesting replaces the chunks (new content, new count, no duplicates)', async () => {
    const { upload } = await setup();
    const doc = await upload('v.txt', MIME.txt, Buffer.from(sentences(80, 'first version'), 'utf8'));
    const first = await ingestDocument(doc.id);
    const before = await getChunks(doc.id);
    expect(before[0]!.content).toContain('first version');

    await storage.save(doc.storageKey, Buffer.from('Completely different second version text.', 'utf8'));
    const second = await ingestDocument(doc.id);

    expect(first.chunkCount).toBeGreaterThan(second.chunkCount);
    const after = await getChunks(doc.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.content).toBe('Completely different second version text.');
    expect(after[0]!.id).not.toBe(before[0]!.id);
    expect((await getDoc(doc.id)).ingestionStatus).toBe('READY');
  });

  it('re-running with unchanged content gives the same chunks', async () => {
    const { upload } = await setup();
    const doc = await upload('same.txt', MIME.txt, Buffer.from(sentences(50, 'stable'), 'utf8'));
    await ingestDocument(doc.id);
    const a = (await getChunks(doc.id)).map((c) => c.content);
    await ingestDocument(doc.id);
    const b = (await getChunks(doc.id)).map((c) => c.content);
    expect(b).toEqual(a);
  });

  it('a successful retry after a FAILED run recovers the document', async () => {
    const { upload } = await setup();
    const doc = await upload('x.txt', MIME.txt, Buffer.alloc(0));
    expect((await ingestDocument(doc.id)).status).toBe('FAILED');
    await storage.save(doc.storageKey, Buffer.from('Now there is real content.'));
    expect((await ingestDocument(doc.id)).status).toBe('READY');
    expect(await getChunks(doc.id)).toHaveLength(1);
  });

  it('concurrent ingestions of the same document are serialised and consistent', async () => {
    const { upload } = await setup();
    const doc = await upload('c.txt', MIME.txt, Buffer.from(sentences(80, 'concurrency'), 'utf8'));
    const results = await Promise.all([ingestDocument(doc.id), ingestDocument(doc.id), ingestDocument(doc.id)]);
    expect(results.every((r) => r.status === 'READY')).toBe(true);
    const chunks = await getChunks(doc.id);
    expect(chunks).toHaveLength(results[0]!.chunkCount);
    expect(new Set(chunks.map((c) => c.chunk_index)).size).toBe(chunks.length);
  });

  it('chunks belong only to their own document; other documents are untouched', async () => {
    const { upload } = await setup();
    const a = await upload('a.txt', MIME.txt, Buffer.from(sentences(30, 'alpha topic'), 'utf8'));
    const b = await upload('b.txt', MIME.txt, Buffer.from(sentences(30, 'beta topic'), 'utf8'));
    await ingestDocument(a.id);
    await ingestDocument(b.id);
    const bBefore = await getChunks(b.id);
    await ingestDocument(a.id); // re-ingest A must not touch B
    expect(await getChunks(b.id)).toEqual(bBefore);
    expect((await getChunks(a.id)).every((c) => c.content.includes('alpha'))).toBe(true);
    expect(bBefore.every((c) => c.content.includes('beta'))).toBe(true);
    expect(await prisma.documentChunk.count()).toBe((await getChunks(a.id)).length + bBefore.length);
  });

  it('deleting the document cascades to its chunks', async () => {
    const { upload } = await setup();
    const doc = await upload('d.txt', MIME.txt, Buffer.from('Some text about cascade deletes.'));
    await ingestDocument(doc.id);
    await prisma.document.delete({ where: { id: doc.id } });
    expect(await prisma.documentChunk.count()).toBe(0);
  });
});
