import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { visibleProjectsWhere } from '../projects/projects.scope';
import { getEmbeddingProvider } from './embeddings';
import { getLlmProvider } from './llm';
import { aiLog } from './log';
import { searchChunks, type ChunkHit } from './search';

export const askSchema = z.object({ question: z.string().trim().min(3).max(1000) }).strict();
export const interactionsQuerySchema = z.object({
  flagged: z.enum(['true', 'false']).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, 100)),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const NO_RELEVANT_INFO = 'No se encontró información suficientemente relevante en los documentos del proyecto.';

const toSource = (h: ChunkHit) => ({
  documentId: h.documentId,
  fileName: h.fileName,
  chunkIndex: h.chunkIndex,
  pageNumber: h.pageNumber,
  similarity: Math.round(h.similarity * 1000) / 1000,
  excerpt: h.content.trim().replace(/\s+/g, ' ').slice(0, 300),
});

/**
 * RAG question answering (FR-007, FR-008, AIR-001..005). The project boundary is enforced twice: the caller must be able
 * to see the project (scoping in the WHERE) and retrieval is restricted to that project's chunks in SQL.
 * Order matters: retrieval -> confidence check -> LLM. Citations come from the retrieval step, never from the LLM (AIR-003).
 */
export async function askProject(projectId: string, input: z.infer<typeof askSchema>, user: AuthUser) {
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: { id: true, status: true },
  });
  if (!project) throw new HttpError(404, 'Project not found');
  const started = Date.now();

  const unavailable = () =>
    new HttpError(503, 'El asistente de IA no está disponible temporalmente. Inténtalo de nuevo más tarde.', {
      code: 'AI_UNAVAILABLE',
    });

  let hits: ChunkHit[];
  try {
    const [vector] = await getEmbeddingProvider().embed([input.question]);
    hits = await searchChunks(projectId, vector!, env.AI_TOP_K);
  } catch (err) {
    aiLog.error('retrieval failed', { projectId, reason: (err as Error)?.name });
    throw unavailable();
  }

  const relevant = hits.filter((h) => h.similarity >= env.AI_MIN_SIMILARITY);
  const confidence = hits[0]?.similarity ?? 0;

  const log = (extra: { response: string | null; model: string | null; fallback: boolean; tokens?: [number?, number?] }) =>
    prisma.aiInteractionLog.create({
      data: {
        userId: user.id,
        projectId,
        prompt: input.question,
        response: extra.response,
        model: extra.model,
        promptTokens: extra.tokens?.[0],
        completionTokens: extra.tokens?.[1],
        latencyMs: Date.now() - started,
        confidence,
        fallback: extra.fallback,
        retrievalAudits: {
          create: relevant.map((h, i) => ({ chunkId: h.chunkId, similarityScore: h.similarity, rank: i + 1 })),
        },
      },
    });

  // AIR-004: refuse instead of generating an unsupported answer.
  if (relevant.length === 0) {
    const row = await log({ response: NO_RELEVANT_INFO, model: null, fallback: true });
    return { interactionId: row.id, answer: null, message: NO_RELEVANT_INFO, fallback: true, aiGenerated: false, confidence, sources: [] };
  }

  let generated;
  try {
    generated = await getLlmProvider().answer(
      input.question,
      relevant.map((h) => ({ fileName: h.fileName, content: h.content })),
    );
  } catch (err) {
    aiLog.error('generation failed', { projectId, reason: (err as Error)?.name });
    await log({ response: null, model: null, fallback: true }).catch(() => undefined);
    throw unavailable();
  }

  const row = await log({
    response: generated.text,
    model: generated.model,
    fallback: false,
    tokens: [generated.promptTokens, generated.completionTokens],
  });
  return {
    interactionId: row.id,
    answer: generated.text,
    message: null,
    fallback: false,
    // AIR-009: the client must label this as AI-generated.
    aiGenerated: true,
    confidence,
    sources: relevant.map(toSource),
  };
}

/** The caller's own recent exchanges for a project, so the chat survives a reload. */
export async function listMyInteractions(projectId: string, user: AuthUser) {
  const visible = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: { id: true },
  });
  if (!visible) throw new HttpError(404, 'Project not found');
  const rows = await prisma.aiInteractionLog.findMany({
    where: { projectId, userId: user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
    include: {
      retrievalAudits: {
        orderBy: { rank: 'asc' },
        include: { chunk: { select: { chunkIndex: true, pageNumber: true, content: true, document: { select: { id: true, fileName: true } } } } },
      },
    },
  });
  return {
    data: rows.reverse().map((r) => ({
      interactionId: r.id,
      question: r.prompt,
      answer: r.fallback ? null : r.response,
      message: r.fallback ? r.response : null,
      fallback: r.fallback,
      flagged: r.flagged,
      createdAt: r.createdAt,
      sources: r.retrievalAudits.map((a) => ({
        documentId: a.chunk.document.id,
        fileName: a.chunk.document.fileName,
        chunkIndex: a.chunk.chunkIndex,
        pageNumber: a.chunk.pageNumber,
        similarity: Math.round(a.similarityScore * 1000) / 1000,
        excerpt: a.chunk.content.trim().replace(/\s+/g, ' ').slice(0, 300),
      })),
    })),
  };
}

/** AIR-007: the user who received an answer can report it as incorrect. Another user's id is a 404. */
export async function flagInteraction(id: string, user: AuthUser) {
  const result = await prisma.aiInteractionLog.updateMany({
    where: { id, userId: user.id },
    data: { flagged: true, flaggedAt: new Date() },
  });
  if (result.count === 0) throw new HttpError(404, 'Interaction not found');
  return { interactionId: id, flagged: true };
}

/** AIR-005: administrators review the interaction log. */
export async function listInteractions(query: z.infer<typeof interactionsQuerySchema>) {
  const where = query.flagged ? { flagged: query.flagged === 'true' } : {};
  const [rows, total] = await prisma.$transaction([
    prisma.aiInteractionLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
      include: { user: { select: { fullName: true } }, project: { select: { id: true, title: true } } },
    }),
    prisma.aiInteractionLog.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      user: r.user.fullName,
      project: r.project,
      question: r.prompt,
      answer: r.response,
      fallback: r.fallback,
      flagged: r.flagged,
      confidence: r.confidence,
      latencyMs: r.latencyMs,
      model: r.model,
      createdAt: r.createdAt,
    })),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}
