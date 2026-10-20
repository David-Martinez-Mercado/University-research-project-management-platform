import { prisma } from '../db/prisma';
import { toVectorLiteral } from './vector';

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  fileName: string;
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  /** Cosine similarity in [-1, 1] (1 = identical direction). */
  similarity: number;
}

/**
 * Nearest chunks to a query vector, restricted to ONE project's READY documents (the project boundary is
 * enforced here, in SQL, so callers cannot leak chunks across projects). `<=>` is cosine distance, matching
 * the HNSW `vector_cosine_ops` index. Parameters: $1 query vector, $2 project id, $3 limit.
 */
export const SEARCH_CHUNKS_SQL = `
  SELECT c.id AS "chunkId", c.document_id AS "documentId", d.file_name AS "fileName",
         c.chunk_index AS "chunkIndex", c.page_number AS "pageNumber", c.content,
         (1 - (c.embedding_vector <=> $1::vector))::float8 AS similarity
  FROM document_chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE d.project_id = $2::uuid
    AND d.ingestion_status = 'READY'
    AND c.embedding_vector IS NOT NULL
  ORDER BY c.embedding_vector <=> $1::vector
  LIMIT $3::int`;

// pgvector >= 0.8 can keep scanning the HNSW index until enough rows survive the project filter. Without it,
// a filtered query can return fewer than k rows when other projects' vectors crowd the index's candidate list.
// Older pgvector rejects the setting; we detect that once and fall back to the plain query.
let iterativeScanSupported: boolean | undefined;

export async function searchChunks(projectId: string, queryEmbedding: readonly number[], k = 5): Promise<ChunkHit[]> {
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('k must be an integer between 1 and 100');
  const vector = toVectorLiteral(queryEmbedding);

  if (iterativeScanSupported !== false) {
    try {
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL hnsw.iterative_scan = 'strict_order'");
        return tx.$queryRawUnsafe<ChunkHit[]>(SEARCH_CHUNKS_SQL, vector, projectId, k);
      });
      iterativeScanSupported = true;
      return rows;
    } catch (err) {
      if (iterativeScanSupported === true || !/hnsw\.iterative_scan|unrecognized configuration/i.test(String(err))) throw err;
      iterativeScanSupported = false;
    }
  }
  return prisma.$queryRawUnsafe<ChunkHit[]>(SEARCH_CHUNKS_SQL, vector, projectId, k);
}
