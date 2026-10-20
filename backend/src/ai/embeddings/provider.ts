/** Must match `document_chunks.embedding_vector vector(1536)` (docs/DATABASE.md). */
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  readonly dimensions: number;
  /** One vector per input text, same order. Every vector has exactly `dimensions` finite numbers. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Any provider failure. The message never contains API keys or the embedded text. */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** Throws EmbeddingError unless there is one well-formed vector of `dimensions` per input. */
export function assertValidEmbeddings(vectors: unknown, expectedCount: number, dimensions: number): asserts vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new EmbeddingError(
      `Embedding provider returned ${Array.isArray(vectors) ? vectors.length : 'no'} vectors for ${expectedCount} inputs`,
    );
  }
  vectors.forEach((v, i) => {
    if (!Array.isArray(v) || v.length !== dimensions) {
      throw new EmbeddingError(
        `Embedding ${i} has ${Array.isArray(v) ? v.length : 'invalid'} dimensions, expected ${dimensions}. ` +
          'The database column is vector(1536): use a 1536-dimension model or migrate the column.',
      );
    }
    if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new EmbeddingError(`Embedding ${i} contains non-finite values`);
    }
  });
}
