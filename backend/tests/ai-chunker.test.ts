import { describe, expect, it } from 'vitest';
import { chunkSegments, chunkText, DEFAULT_CHUNK_OPTIONS, estimateTokens, overlapTail } from '../src/ai/chunker';

const { maxChars, overlapChars } = DEFAULT_CHUNK_OPTIONS;

function sentences(n: number, prefix = 'Sentence'): string {
  return Array.from({ length: n }, (_, i) => `${prefix} number ${i} talks about the quantum sensing experiment and its results.`).join(' ');
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('chunker: edge cases', () => {
  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n \t ')).toEqual([]);
    expect(chunkSegments([])).toEqual([]);
  });

  it('keeps tiny input as a single chunk', () => {
    const chunks = chunkText('Hola mundo.');
    expect(chunks).toEqual([{ chunkIndex: 0, content: 'Hola mundo.', pageNumber: null, tokenCount: estimateTokens('Hola mundo.') }]);
  });

  it('is deterministic', () => {
    const text = sentences(80);
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it('numbers chunks sequentially and estimates tokens as ~chars/4', () => {
    const chunks = chunkText(sentences(60));
    chunks.forEach((c, i) => {
      expect(c.chunkIndex).toBe(i);
      expect(c.tokenCount).toBe(Math.ceil(c.content.length / 4));
    });
  });

  it('rejects inconsistent options', () => {
    expect(() => chunkText('x', { overlapChars: 900, targetChars: 900 })).toThrow();
    expect(() => chunkText('x', { targetChars: 1200, maxChars: 1000 })).toThrow();
  });
});

describe('chunker: sizes and boundaries', () => {
  it('splits a huge single paragraph into chunks within the limits, covering every sentence in order', () => {
    const n = 400;
    const text = sentences(n);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(maxChars);
      expect(c.content.length).toBeGreaterThan(0);
    }
    // Chunks ending before the last one are close to the target size (not tiny fragments).
    for (const c of chunks.slice(0, -1)) expect(c.content.length).toBeGreaterThanOrEqual(600);
    // Every sentence appears whole in at least one chunk, and first occurrences are in order.
    let lastChunk = 0;
    for (let i = 0; i < n; i++) {
      const s = `Sentence number ${i} talks about the quantum sensing experiment and its results.`;
      const at = chunks.findIndex((c, idx) => idx >= lastChunk && c.content.includes(s));
      expect(at, `sentence ${i} missing or out of order`).toBeGreaterThanOrEqual(0);
      lastChunk = at;
    }
  });

  it('never cuts mid-word (text made of normal words)', () => {
    const words = ['investigación', 'señalización', 'análisis', 'ñandú', 'cuántica', 'sensor', 'γραφή', '研究プロジェクト'];
    const text = Array.from({ length: 1500 }, (_, i) => words[i % words.length]).join(' ');
    const vocabulary = new Set(words);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      for (const w of c.content.split(/\s+/)) expect(vocabulary.has(w), `broken word: ${w}`).toBe(true);
    }
  });

  it('handles one enormous sentence without punctuation by splitting at spaces', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = chunkText(text);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(maxChars);
      for (const w of c.content.split(' ')) expect(w).toMatch(/^palabra\d+$/);
    }
    // All words survive.
    const seen = new Set(chunks.flatMap((c) => c.content.split(' ')));
    expect(seen.size).toBe(3000);
  });

  it('hard-cuts a single giant token (URL / base64) without losing characters or splitting surrogate pairs', () => {
    const token = '😀a'.repeat(3000); // 9000 UTF-16 units, no whitespace
    const chunks = chunkText(token);
    expect(chunks.length).toBeGreaterThan(8);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(maxChars);
      expect(LONE_SURROGATE.test(c.content)).toBe(false);
    }
    // A single token has no clean overlap point, so the pieces tile the original exactly (nothing lost or repeated).
    expect(chunks.map((c) => c.content).join('').replace(/\s/g, '')).toBe(token);
  });

  it('preserves accents, ñ and combining sequences (NFC text stays intact)', () => {
    const text = 'La investigación cuántica señala que el niño comió piña. ¿Será cierto? ¡Claro que sí! Évaluation à Paris.';
    const [chunk] = chunkText(text);
    expect(chunk!.content).toBe(text);
  });

  it('splits sentences after ¿ ¡ and quotes, and keeps paragraph breaks as blank lines', () => {
    const chunks = chunkText('Primer párrafo aquí.\n\nSegundo párrafo: "Frase uno." ¿Frase dos? Tres.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('Primer párrafo aquí.\n\nSegundo párrafo: "Frase uno." ¿Frase dos? Tres.');
  });

  it('collapses internal newlines and runs of whitespace (including NBSP) inside a paragraph', () => {
    const [chunk] = chunkText('line one\nline  two  still   two');
    expect(chunk!.content).toBe('line one line two still two');
  });
});

describe('chunker: overlap', () => {
  it('starts every next chunk with a suffix of the previous one (<= overlapChars, on a word boundary)', () => {
    const chunks = chunkText(sentences(200));
    expect(chunks.length).toBeGreaterThan(5);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!.content;
      const cur = chunks[i]!.content;
      // Longest prefix of `cur` that is a suffix of `prev`.
      let shared = '';
      for (let len = Math.min(prev.length, cur.length, overlapChars + 5); len > 0; len--) {
        if (prev.endsWith(cur.slice(0, len))) {
          shared = cur.slice(0, len);
          break;
        }
      }
      expect(shared.length, `chunk ${i} has no overlap`).toBeGreaterThan(20);
      expect(shared.length).toBeLessThanOrEqual(overlapChars);
      // Overlap begins at a word start inside prev.
      const startInPrev = prev.length - shared.length;
      expect(startInPrev === 0 || /\s/.test(prev[startInPrev - 1]!)).toBe(true);
    }
  });

  it('overlapTail prefers a sentence start and never starts mid-word', () => {
    const content = 'Alpha beta gamma delta epsilon. Zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau.';
    const tail = overlapTail(content, 90);
    expect(content.endsWith(tail)).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(90);
    expect(tail.startsWith('Zeta')).toBe(true);
    const noPunct = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince';
    const t2 = overlapTail(noPunct, 30);
    expect(noPunct.endsWith(t2)).toBe(true);
    expect(t2.length).toBeLessThanOrEqual(30);
    expect(noPunct.split(' ')).toContain(t2.split(' ')[0]);
  });

  it('does not overlap across pages and keeps the exact pageNumber', () => {
    const chunks = chunkSegments([
      { text: sentences(30, 'Alpha'), pageNumber: 1 },
      { text: 'Short second page.', pageNumber: 2 },
      { text: sentences(30, 'Gamma'), pageNumber: 3 },
    ]);
    const pages = chunks.map((c) => c.pageNumber);
    expect(pages).toEqual([...pages].sort((a, b) => a! - b!)); // non-decreasing
    expect(new Set(pages)).toEqual(new Set([1, 2, 3]));
    for (const c of chunks) {
      if (c.pageNumber === 1) expect(c.content).not.toMatch(/Gamma|second page/);
      if (c.pageNumber === 2) expect(c.content).toBe('Short second page.');
      if (c.pageNumber === 3) expect(c.content).not.toMatch(/Alpha|second page/);
    }
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i)); // index continues across pages
  });
});
