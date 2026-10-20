import type { TextSegment } from './extract';

export interface Chunk {
  chunkIndex: number;
  content: string;
  /** Page the chunk belongs to (chunks never span pages); null for formats without pages. */
  pageNumber: number | null;
  /** Approximation (characters / 4). Not a real tokenizer; good enough for budgeting. */
  tokenCount: number;
}

export interface ChunkOptions {
  /** Soft target: chunks are closed once adding the next sentence would exceed this. */
  targetChars: number;
  /** Characters of the previous chunk repeated at the start of the next one. */
  overlapChars: number;
  /** Hard upper bound for any chunk (target + overlap headroom). */
  maxChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetChars: 900,
  overlapChars: 120,
  maxChars: 1000,
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// A sentence ends at . ! ? … (optionally followed by a closing quote/bracket) and the next one starts with
// an uppercase letter, digit or opening mark. Lookbehind/lookahead keep the punctuation attached.
const SENTENCE_BOUNDARY = /(?<=[.!?…]["”’)\]]?)\s+(?=["“‘¿¡(\[]?[\p{Lu}\d])/u;

/** Cuts index must not fall between the two halves of a surrogate pair. */
function safeCut(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index;
}

/** Splits `text` into pieces of at most `max` chars, at whitespace when possible (a single token longer than `max` is hard-cut). */
function splitAtWords(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = safeCut(rest, max); // no space within reach: hard cut inside a giant token
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out.filter((p) => p.length > 0);
}

interface Atom {
  text: string;
  /** Separator placed before this atom when it follows another one in the same chunk. */
  sep: string;
}

function toAtoms(text: string, maxAtom: number): Atom[] {
  const atoms: Atom[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const flat = para.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    let first = true;
    for (const sentence of flat.split(SENTENCE_BOUNDARY)) {
      for (const piece of splitAtWords(sentence, maxAtom)) {
        atoms.push({ text: piece, sep: first ? '\n\n' : ' ' });
        first = false;
      }
    }
  }
  return atoms;
}

/** The last <= overlapChars of `content`, starting on a sentence boundary if possible, otherwise on a word boundary. */
export function overlapTail(content: string, overlapChars: number): string {
  if (overlapChars <= 0 || content.length === 0) return '';
  if (content.length <= overlapChars) return content.trim();
  const window = content.slice(content.length - overlapChars);
  // The window may begin mid-word: skip to the first whitespace-delimited start.
  const startsMidWord = !/\s/.test(content[content.length - overlapChars - 1] ?? ' ');
  let tail = startsMidWord ? window.replace(/^\S*\s+/, '') : window.trimStart();
  if (startsMidWord && tail === window) tail = ''; // window is one single token: no clean cut exists
  // Prefer to start at a sentence start inside the tail, if that keeps a meaningful amount of context.
  const parts = tail.split(SENTENCE_BOUNDARY);
  if (parts.length > 1) {
    const lastSentence = parts[parts.length - 1]!;
    if (lastSentence.length >= overlapChars * 0.4) tail = lastSentence;
  }
  return tail.trim();
}

/**
 * Deterministic chunker. Each segment (PDF page) is chunked independently so every chunk has an exact page.
 * Chunks are built from whole sentences (long sentences are split at spaces), joined back with a space or a
 * blank line between paragraphs, and consecutive chunks of the same segment share `overlapChars` of text.
 */
export function chunkSegments(segments: TextSegment[], options: Partial<ChunkOptions> = {}): Chunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  if (opts.overlapChars >= opts.targetChars || opts.targetChars > opts.maxChars) {
    throw new Error('Invalid chunk options: require overlap < target <= max');
  }
  // Room guaranteed for overlap + separator + one atom inside maxChars.
  const maxAtom = opts.maxChars - opts.overlapChars - 2;
  if (maxAtom < 50) throw new Error('Invalid chunk options: maxChars - overlapChars too small');

  const chunks: Chunk[] = [];
  const push = (content: string, pageNumber: number | null) => {
    chunks.push({ chunkIndex: chunks.length, content, pageNumber, tokenCount: estimateTokens(content) });
  };

  for (const segment of segments) {
    const atoms = toAtoms(segment.text, maxAtom);
    let current = ''; // text of the chunk being built (may start with the carried-over overlap)

    for (const atom of atoms) {
      const joined = current ? current + atom.sep + atom.text : atom.text;
      if (current && joined.length > opts.targetChars) {
        push(current, segment.pageNumber);
        const tail = overlapTail(current, opts.overlapChars);
        current = tail ? tail + atom.sep + atom.text : atom.text;
      } else {
        current = joined;
      }
    }
    if (current) push(current, segment.pageNumber);
  }
  return chunks;
}

export function chunkText(text: string, options: Partial<ChunkOptions> = {}): Chunk[] {
  return chunkSegments([{ text, pageNumber: null }], options);
}
