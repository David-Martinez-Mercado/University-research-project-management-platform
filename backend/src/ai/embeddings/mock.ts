import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './provider';

/** FNV-1a 32-bit. Deterministic across platforms/runs (unlike Math.random or Map ordering). */
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // "investigación" and "investigacion" collide on purpose
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Offline, deterministic "embedding": hashed bag of words (+ bigrams at lower weight) projected into 1536
 * dimensions and L2-normalised. Identical text -> identical vector; texts sharing words -> higher cosine.
 * It captures LEXICAL overlap only (no synonyms): good for dev/tests, NOT for production retrieval quality.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, c] of counts) v[fnv1a(t) % this.dimensions]! += 1 + Math.log(c);
    for (let i = 0; i + 1 < tokens.length; i++) {
      v[fnv1a(`${tokens[i]} ${tokens[i + 1]}`, 0x9747b28c) % this.dimensions]! += 0.5;
    }

    let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm === 0) {
      // No letters/digits at all (e.g. "!!!"): pgvector cosine distance is undefined for the zero vector.
      v[fnv1a(text) % this.dimensions] = 1;
      norm = 1;
    }
    return v.map((x) => x / norm);
  }
}
