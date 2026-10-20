import { EMBEDDING_DIMENSIONS } from './embeddings/provider';

/**
 * pgvector text literal for a vector, e.g. `[0.1,0.2]`. Built only from validated numbers and always passed to
 * PostgreSQL as a bound parameter (`$n::vector`), never concatenated into SQL.
 */
export function toVectorLiteral(vector: readonly number[], dimensions = EMBEDDING_DIMENSIONS): string {
  if (vector.length !== dimensions) {
    throw new Error(`Vector has ${vector.length} dimensions, expected ${dimensions}`);
  }
  const parts = new Array<string>(vector.length);
  for (let i = 0; i < vector.length; i++) {
    const x = vector[i]!;
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('Vector contains a non-finite value');
    // pgvector stores float4: 8 significant digits are plenty and keep the payload small.
    parts[i] = String(parseFloat(x.toPrecision(8)));
  }
  return `[${parts.join(',')}]`;
}
