import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestDocument, searchChunks } from '../src/ai';
import { MockEmbeddingProvider, setEmbeddingProviderForTests } from '../src/ai/embeddings';
import { SEARCH_CHUNKS_SQL } from '../src/ai/search';
import { toVectorLiteral } from '../src/ai/vector';
import { prisma } from '../src/db/prisma';
import { setStorageForTests } from '../src/documents/storage';
import { makeDocument, makeOwner, makeProject, MIME, resetAiDb, TempDirStorage } from './ai-helpers';

const mock = new MockEmbeddingProvider();
const embedOne = async (text: string) => (await mock.embed([text]))[0]!;

let storage: TempDirStorage;

beforeAll(async () => {
  storage = await TempDirStorage.create();
  setStorageForTests(storage);
  setEmbeddingProviderForTests(mock);
});

afterAll(async () => {
  setStorageForTests(undefined);
  setEmbeddingProviderForTests(undefined);
  await storage.dispose();
  await prisma.$disconnect();
});

beforeEach(resetAiDb);

async function ingestText(projectId: string, uploadedById: string, fileName: string, text: string) {
  const doc = await makeDocument({
    storage,
    projectId,
    uploadedById,
    fileName,
    mimeType: MIME.txt,
    data: Buffer.from(text, 'utf8'),
  });
  const result = await ingestDocument(doc.id);
  expect(result.status).toBe('READY');
  return doc;
}

const SOLAR = 'The photovoltaic panel efficiency improved after applying the perovskite coating to the silicon cells.';
const WATER = 'Wastewater treatment plants reduce nitrate concentration using anaerobic bacteria in sequencing batch reactors.';
const ROBOT = 'The robotic arm trajectory planner minimises joint torque with a model predictive controller.';

describe('searchChunks', () => {
  it('returns the most relevant chunk first, with similarity, metadata and file name', async () => {
    const owner = await makeOwner();
    const project = await makeProject(owner.id);
    const solar = await ingestText(project.id, owner.id, 'solar.txt', SOLAR);
    await ingestText(project.id, owner.id, 'water.txt', WATER);
    await ingestText(project.id, owner.id, 'robot.txt', ROBOT);

    const hits = await searchChunks(project.id, await embedOne('perovskite coating for photovoltaic panel efficiency'), 3);

    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({ documentId: solar.id, fileName: 'solar.txt', chunkIndex: 0, pageNumber: null, content: SOLAR });
    expect(hits[0]!.similarity).toBeGreaterThan(0.4);
    // Sorted by descending similarity and all within [-1, 1].
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1]!.similarity).toBeGreaterThanOrEqual(hits[i]!.similarity);
    expect(hits.every((h) => h.similarity <= 1.0000001 && h.similarity >= -1.0000001)).toBe(true);
  });

  it('respects k and validates it', async () => {
    const owner = await makeOwner();
    const project = await makeProject(owner.id);
    await ingestText(project.id, owner.id, 'a.txt', SOLAR);
    await ingestText(project.id, owner.id, 'b.txt', WATER);
    await ingestText(project.id, owner.id, 'c.txt', ROBOT);
    expect(await searchChunks(project.id, await embedOne(WATER), 1)).toHaveLength(1);
    expect(await searchChunks(project.id, await embedOne(WATER), 10)).toHaveLength(3);
    await expect(searchChunks(project.id, await embedOne(WATER), 0)).rejects.toThrow(/k must be/);
  });

  it('NEVER returns chunks from another project, even when they are the best match', async () => {
    const owner = await makeOwner();
    const projectA = await makeProject(owner.id, 'A');
    const projectB = await makeProject(owner.id, 'B');
    await ingestText(projectA.id, owner.id, 'a-robot.txt', ROBOT);
    const bSolar = await ingestText(projectB.id, owner.id, 'b-solar.txt', SOLAR);

    const query = await embedOne(SOLAR); // identical to B's chunk
    const inA = await searchChunks(projectA.id, query, 5);
    expect(inA).toHaveLength(1);
    expect(inA[0]!.fileName).toBe('a-robot.txt');
    expect(inA.some((h) => h.documentId === bSolar.id)).toBe(false);

    const inB = await searchChunks(projectB.id, query, 5);
    expect(inB.map((h) => h.fileName)).toEqual(['b-solar.txt']);
    expect(inB[0]!.similarity).toBeCloseTo(1, 4);
  });

  it('still returns k project results when another project has many closer vectors', async () => {
    const owner = await makeOwner();
    const mine = await makeProject(owner.id, 'mine');
    const other = await makeProject(owner.id, 'other');
    await ingestText(mine.id, owner.id, 'm1.txt', 'Sensor calibration notes for the lab.');
    await ingestText(mine.id, owner.id, 'm2.txt', 'Calibration schedule and budget.');
    await ingestText(mine.id, owner.id, 'm3.txt', 'Sensor maintenance log.');
    // ~100 chunks in another project that are nearer to the query than anything in `mine`.
    const crowd = Array.from({ length: 1500 }, (_, i) => `Sensor calibration procedure number ${i} for the quantum sensor lab.`).join(' ');
    await ingestText(other.id, owner.id, 'crowd.txt', crowd);
    expect(await prisma.documentChunk.count()).toBeGreaterThan(100);

    const hits = await searchChunks(mine.id, await embedOne('sensor calibration procedure quantum lab'), 3);
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((h) => h.fileName))).toEqual(new Set(['m1.txt', 'm2.txt', 'm3.txt']));
  });

  it('only searches READY documents (a PROCESSING or FAILED document is invisible)', async () => {
    const owner = await makeOwner();
    const project = await makeProject(owner.id);
    const doc = await ingestText(project.id, owner.id, 'a.txt', SOLAR);
    const query = await embedOne(SOLAR);
    expect(await searchChunks(project.id, query, 5)).toHaveLength(1);
    await prisma.document.update({ where: { id: doc.id }, data: { ingestionStatus: 'PROCESSING' } });
    expect(await searchChunks(project.id, query, 5)).toHaveLength(0);
    await prisma.document.update({ where: { id: doc.id }, data: { ingestionStatus: 'READY' } });
    expect(await searchChunks(project.id, query, 5)).toHaveLength(1);
  });

  it('rejects vectors of the wrong dimension before touching SQL', async () => {
    await expect(searchChunks('00000000-0000-0000-0000-000000000000', [0.1, 0.2], 3)).rejects.toThrow(/dimensions/);
  });

  it('treats the project id as a bound parameter (no SQL injection)', async () => {
    const owner = await makeOwner();
    const project = await makeProject(owner.id);
    await ingestText(project.id, owner.id, 'a.txt', SOLAR);
    await expect(searchChunks("x'; DROP TABLE documents; --", await embedOne(SOLAR), 3)).rejects.toThrow(); // invalid uuid
    expect(await prisma.document.count()).toBe(1);
  });
});

describe('HNSW index usage', () => {
  async function explain(sql: string, params: unknown[], settings: string[]) {
    return prisma.$transaction(async (tx) => {
      for (const setting of settings) await tx.$executeRawUnsafe(`SET LOCAL ${setting}`);
      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`, ...params);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
  }

  async function seed() {
    const owner = await makeOwner();
    const project = await makeProject(owner.id);
    await ingestText(project.id, owner.id, 'a.txt', SOLAR + '\n\n' + WATER + '\n\n' + ROBOT);
    return { project, vector: toVectorLiteral(await embedOne(SOLAR)) };
  }

  it('a plain nearest-neighbour cosine query uses the HNSW index when sequential scans are disabled', async () => {
    const { vector } = await seed();
    const plan = await explain(
      'SELECT id FROM document_chunks ORDER BY embedding_vector <=> $1::vector LIMIT 5',
      [vector],
      ['enable_seqscan = off'],
    );
    expect(plan).toContain('Index Scan using document_chunks_embedding_vector_hnsw_idx');
  });

  it('the real project-filtered search query can be served by the HNSW index (<=> matches vector_cosine_ops)', async () => {
    const { project, vector } = await seed();
    // On a tiny table the planner (correctly) prefers the exact plan: project filter -> chunks -> sort. Disabling
    // seqscan AND explicit sorts removes that alternative, leaving the ordered HNSW scan as the only way to satisfy ORDER BY.
    const plan = await explain(SEARCH_CHUNKS_SQL, [vector, project.id, 5], ['enable_seqscan = off', 'enable_sort = off']);
    expect(plan).toContain('document_chunks_embedding_vector_hnsw_idx');
  });
});
