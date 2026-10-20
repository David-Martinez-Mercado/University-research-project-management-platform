import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recoverPendingIngestions } from '../src/ai';
import { MockEmbeddingProvider, setEmbeddingProviderForTests } from '../src/ai/embeddings';
import { prisma } from '../src/db/prisma';
import { setStorageForTests } from '../src/documents/storage';
import { makeDocument, makeOwner, makeProject, MIME, resetAiDb, TempDirStorage } from './ai-helpers';

let storage: TempDirStorage;

beforeAll(async () => {
  storage = await TempDirStorage.create();
  setStorageForTests(storage);
});

afterAll(async () => {
  setStorageForTests(undefined);
  setEmbeddingProviderForTests(undefined);
  await storage.dispose();
  await prisma.$disconnect();
});

beforeEach(async () => {
  setEmbeddingProviderForTests(new MockEmbeddingProvider());
  await resetAiDb();
});

const text = (s: string) => Buffer.from(s, 'utf8');
const getDoc = (id: string) => prisma.document.findUniqueOrThrow({ where: { id } });
const chunkCount = (id: string) => prisma.documentChunk.count({ where: { documentId: id } });

async function setup() {
  const owner = await makeOwner();
  const project = await makeProject(owner.id);
  const upload = (fileName: string, body: string) =>
    makeDocument({ storage, projectId: project.id, uploadedById: owner.id, fileName, mimeType: MIME.txt, data: text(body) });
  return { upload };
}

describe('recoverPendingIngestions (documents left unindexed by a restart)', () => {
  it('indexes documents stuck in PENDING and PROCESSING', async () => {
    const { upload } = await setup();
    const a = await upload('a.txt', 'Quantum sensors measure tiny magnetic fields with great precision.');
    const b = await upload('b.txt', 'Photosynthesis converts sunlight into chemical energy in chloroplasts.');
    await prisma.document.update({ where: { id: b.id }, data: { ingestionStatus: 'PROCESSING' } });

    expect(await recoverPendingIngestions()).toBe(2);

    for (const d of [a, b]) {
      expect((await getDoc(d.id)).ingestionStatus).toBe('READY');
      expect(await chunkCount(d.id)).toBeGreaterThan(0);
    }
  });

  it('leaves READY and FAILED documents alone', async () => {
    const { upload } = await setup();
    const ready = await upload('ready.txt', 'Already indexed content stays as it is.');
    const failed = await upload('failed.txt', 'This one failed before and is not retried automatically.');
    await prisma.document.update({ where: { id: ready.id }, data: { ingestionStatus: 'READY' } });
    await prisma.document.update({ where: { id: failed.id }, data: { ingestionStatus: 'FAILED' } });

    expect(await recoverPendingIngestions()).toBe(0);

    expect((await getDoc(ready.id)).ingestionStatus).toBe('READY');
    expect((await getDoc(failed.id)).ingestionStatus).toBe('FAILED');
    expect(await chunkCount(ready.id)).toBe(0);
    expect(await chunkCount(failed.id)).toBe(0);
  });

  it('a document whose file is gone ends FAILED without stopping the others', async () => {
    const { upload } = await setup();
    const lost = await upload('lost.txt', 'The bytes of this document were deleted from storage.');
    const fine = await upload('fine.txt', 'This document still has its file and gets indexed normally.');
    await storage.remove(lost.storageKey);

    expect(await recoverPendingIngestions()).toBe(2);

    expect((await getDoc(lost.id)).ingestionStatus).toBe('FAILED');
    expect(await chunkCount(lost.id)).toBe(0);
    expect((await getDoc(fine.id)).ingestionStatus).toBe('READY');
  });

  it('respects the limit and is safe to run twice (idempotent)', async () => {
    const { upload } = await setup();
    const docs = [];
    for (let i = 0; i < 3; i++) docs.push(await upload(`d${i}.txt`, `Document number ${i} talks about robotics and control.`));

    expect(await recoverPendingIngestions(2)).toBe(2);
    expect(await recoverPendingIngestions()).toBe(1); // only the one left
    expect(await recoverPendingIngestions()).toBe(0);

    for (const d of docs) expect((await getDoc(d.id)).ingestionStatus).toBe('READY');
  });
});
