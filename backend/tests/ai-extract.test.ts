import { describe, expect, it } from 'vitest';
import { detectFormat, ExtractionError, extractText, sanitizeText } from '../src/ai/extract';
import { buildDocx, buildPdf, MIME } from './ai-helpers';

async function expectCode(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ExtractionError);
  expect((err as ExtractionError).code).toBe(code);
}

describe('detectFormat', () => {
  it('prefers the file extension, falls back to the MIME type', () => {
    expect(detectFormat('application/octet-stream', 'Report.PDF')).toBe('pdf');
    expect(detectFormat('text/plain', 'notes.md')).toBe('md');
    expect(detectFormat(MIME.docx, 'noext')).toBe('docx');
    expect(detectFormat('text/markdown; charset=utf-8', 'x')).toBe('md');
    expect(detectFormat('image/png', 'a.png')).toBeNull();
    expect(detectFormat(null, null)).toBeNull();
  });
});

describe('sanitizeText', () => {
  it('removes NUL/control chars, lone surrogates and BOM; normalises newlines and NFC', () => {
    expect(sanitizeText('﻿a\u0000b\u0007c\r\nd\re')).toBe('abc\nd\ne');
    expect(sanitizeText('ok\uD800x')).toBe('okx');
    expect(sanitizeText('😀')).toBe('😀');
    expect(sanitizeText('café')).toBe('café'); // decomposed -> composed
  });
});

describe('extractText: TXT / MD', () => {
  it('decodes UTF-8 text with accents', async () => {
    const segs = await extractText(Buffer.from('Investigación cuántica: señal ñandú 😀\n', 'utf8'), { mimeType: MIME.txt, fileName: 'a.txt' });
    expect(segs).toEqual([{ text: 'Investigación cuántica: señal ñandú 😀\n', pageNumber: null }]);
  });

  it('handles Markdown and strips a UTF-8 BOM', async () => {
    const segs = await extractText(Buffer.from('﻿# Título\n\nCuerpo **fuerte**.', 'utf8'), { mimeType: MIME.md, fileName: 'a.md' });
    expect(segs[0]!.text).toBe('# Título\n\nCuerpo **fuerte**.');
  });

  it('rejects empty and whitespace-only files', async () => {
    await expectCode(extractText(Buffer.alloc(0), { fileName: 'a.txt' }), 'EMPTY');
    await expectCode(extractText(Buffer.from('  \n\t\n '), { fileName: 'a.txt' }), 'EMPTY');
  });

  it('rejects binary content declared as text', async () => {
    await expectCode(extractText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]), { fileName: 'a.txt' }), 'CORRUPT');
    await expectCode(extractText(Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]), { fileName: 'a.txt' }), 'CORRUPT');
  });

  it('rejects unsupported types', async () => {
    await expectCode(extractText(Buffer.from('x'), { mimeType: 'image/png', fileName: 'a.png' }), 'UNSUPPORTED_TYPE');
  });
});

describe('extractText: DOCX', () => {
  it('extracts paragraph text (no page numbers available)', async () => {
    const data = await buildDocx(['Primer párrafo con acentos: investigación.', 'Segundo párrafo & <símbolos>.']);
    const segs = await extractText(data, { mimeType: MIME.docx, fileName: 'a.docx' });
    expect(segs).toHaveLength(1);
    expect(segs[0]!.pageNumber).toBeNull();
    expect(segs[0]!.text).toContain('Primer párrafo con acentos: investigación.');
    expect(segs[0]!.text).toContain('Segundo párrafo & <símbolos>.');
  });

  it('fails cleanly on a corrupt or non-zip docx', async () => {
    await expectCode(extractText(Buffer.from('this is not a zip at all'), { fileName: 'a.docx' }), 'CORRUPT');
    const good = await buildDocx(['hola']);
    await expectCode(extractText(good.subarray(0, Math.floor(good.length / 2)), { fileName: 'a.docx' }), 'CORRUPT');
    // OLE2 header of a legacy .doc / password-protected Office file
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expectCode(extractText(ole, { fileName: 'a.docx' }), 'CORRUPT');
  });

  it('fails with EMPTY for a docx without text', async () => {
    await expectCode(extractText(await buildDocx(['', '  ']), { fileName: 'a.docx' }), 'EMPTY');
  });
});

describe('extractText: PDF', () => {
  it('extracts one segment per page with 1-based page numbers', async () => {
    const data = buildPdf(['Hello first page', 'Second page text', 'Third (page) with \\ escapes']);
    const segs = await extractText(data, { mimeType: MIME.pdf, fileName: 'a.pdf' });
    expect(segs.map((s) => s.pageNumber)).toEqual([1, 2, 3]);
    expect(segs[0]!.text.trim()).toBe('Hello first page');
    expect(segs[1]!.text.trim()).toBe('Second page text');
    expect(segs[2]!.text.trim()).toBe('Third (page) with \\ escapes');
  });

  it('skips pages without text but keeps real page numbers', async () => {
    const segs = await extractText(buildPdf(['First', '', 'Third']), { fileName: 'a.pdf' });
    expect(segs.map((s) => s.pageNumber)).toEqual([1, 3]);
  });

  it('fails with EMPTY when no page has text (e.g. scanned PDF)', async () => {
    await expectCode(extractText(buildPdf(['', '']), { fileName: 'a.pdf' }), 'EMPTY');
  });

  it('fails with CORRUPT for garbage, truncated PDFs and wrong magic bytes', async () => {
    await expectCode(extractText(Buffer.from('definitely not a pdf'), { fileName: 'a.pdf' }), 'CORRUPT');
    await expectCode(extractText(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Broken'), { fileName: 'a.pdf' }), 'CORRUPT');
    await expectCode(extractText(await buildDocx(['x']), { fileName: 'actually-docx.pdf' }), 'CORRUPT');
  });

  it('fails with ENCRYPTED for a password-protected PDF', async () => {
    await expectCode(extractText(buildPdf(['secret'], { encrypted: true }), { fileName: 'a.pdf' }), 'ENCRYPTED');
  });
});
