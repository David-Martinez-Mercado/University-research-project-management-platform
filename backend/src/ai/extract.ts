import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/** A run of text with the (1-based) page it came from; `null` when the format has no pages. */
export interface TextSegment {
  text: string;
  pageNumber: number | null;
}

export type ExtractionErrorCode =
  | 'UNSUPPORTED_TYPE' // not PDF/DOCX/TXT/MD (or the bytes do not match the declared type)
  | 'CORRUPT' // damaged / unparsable file
  | 'ENCRYPTED' // password-protected
  | 'EMPTY' // no extractable text (e.g. scanned PDF without OCR)
  | 'TOO_LARGE'; // extracted text exceeds MAX_TEXT_CHARS

/** Thrown for any "this document cannot be turned into text" case. The message never contains file content. */
export class ExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export type DocumentFormat = 'pdf' | 'docx' | 'txt' | 'md';

/** Safety valve: ~3M characters (~750k tokens). Larger documents fail instead of exhausting memory / embedding budget. */
export const MAX_TEXT_CHARS = 3_000_000;

const MIME_TO_FORMAT: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
};

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  md: 'md',
  markdown: 'md',
};

export function detectFormat(mimeType: string | null | undefined, fileName: string | null | undefined): DocumentFormat | null {
  // The extension is more reliable than browser-provided MIME types (often application/octet-stream).
  const ext = fileName?.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (ext && EXT_TO_FORMAT[ext]) return EXT_TO_FORMAT[ext];
  const mime = (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
  return MIME_TO_FORMAT[mime] ?? null;
}

// Lone surrogates make JSON/UTF-8 encoding of query parameters fail; NUL bytes are rejected by PostgreSQL TEXT.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Removes characters that break storage and normalises line endings. Pure and deterministic. */
export function sanitizeText(input: string): string {
  return input
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(LONE_SURROGATE, '')
    .replace(CONTROL_CHARS, '')
    .normalize('NFC');
}

function extractPlain(data: Buffer): TextSegment[] {
  // A NUL byte in the first 8 KB is the classic "this is binary" heuristic.
  if (data.subarray(0, 8192).includes(0)) {
    throw new ExtractionError('CORRUPT', 'File declared as text but contains binary data');
  }
  const text = new TextDecoder('utf-8').decode(data); // invalid bytes become U+FFFD, never throws
  const bad = (text.match(/�/g) ?? []).length;
  if (text.length > 0 && bad / text.length > 0.05) {
    throw new ExtractionError('CORRUPT', 'File declared as text is not valid UTF-8');
  }
  return [{ text, pageNumber: null }];
}

async function extractDocx(data: Buffer): Promise<TextSegment[]> {
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    // Legacy .doc / encrypted Office files are OLE containers, not zip archives.
    throw new ExtractionError('CORRUPT', 'Not a valid DOCX file (missing ZIP signature; legacy .doc and encrypted files are unsupported)');
  }
  try {
    const result = await mammoth.extractRawText({ buffer: data });
    // DOCX is a flow format: page numbers are not stored in the file, so they are unavailable.
    return [{ text: result.value, pageNumber: null }];
  } catch {
    throw new ExtractionError('CORRUPT', 'DOCX could not be parsed');
  }
}

async function extractPdf(data: Buffer): Promise<TextSegment[]> {
  if (!data.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new ExtractionError('CORRUPT', 'Not a valid PDF file (missing %PDF header)');
  }
  // pdf-parse copies nothing out of the Uint8Array it is given, so hand it a private copy.
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ text: p.text, pageNumber: p.num }));
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'PasswordException') {
      throw new ExtractionError('ENCRYPTED', 'PDF is password protected');
    }
    throw new ExtractionError('CORRUPT', `PDF could not be parsed (${name ?? 'unknown error'})`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * Bytes -> sanitised text segments (one per PDF page; a single segment for the other formats).
 * Segments that end up empty are dropped. Throws ExtractionError if nothing usable remains.
 */
export async function extractText(
  data: Buffer,
  info: { mimeType?: string | null; fileName?: string | null },
): Promise<TextSegment[]> {
  const format = detectFormat(info.mimeType, info.fileName);
  if (!format) {
    throw new ExtractionError('UNSUPPORTED_TYPE', 'Unsupported file type (allowed: PDF, DOCX, TXT, MD)');
  }
  if (data.length === 0) {
    throw new ExtractionError('EMPTY', 'File is empty');
  }

  let raw: TextSegment[];
  switch (format) {
    case 'pdf':
      raw = await extractPdf(data);
      break;
    case 'docx':
      raw = await extractDocx(data);
      break;
    default:
      raw = extractPlain(data);
  }

  const segments = raw
    .map((s) => ({ text: sanitizeText(s.text), pageNumber: s.pageNumber }))
    .filter((s) => s.text.trim().length > 0);

  if (segments.length === 0) {
    throw new ExtractionError(
      'EMPTY',
      format === 'pdf' ? 'PDF has no extractable text (scanned images need OCR, which is not supported)' : 'Document has no text',
    );
  }
  const total = segments.reduce((n, s) => n + s.text.length, 0);
  if (total > MAX_TEXT_CHARS) {
    throw new ExtractionError('TOO_LARGE', `Extracted text exceeds the ${MAX_TEXT_CHARS} character limit`);
  }
  return segments;
}
