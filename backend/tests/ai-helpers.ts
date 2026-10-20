import type { IngestionStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { prisma } from '../src/db/prisma';
import type { FileStorage } from '../src/documents/storage';

/** Temp-dir FileStorage (same contract as the real LocalDiskStorage) for ingestion tests. */
export class TempDirStorage implements FileStorage {
  private constructor(readonly root: string) {}
  static async create(): Promise<TempDirStorage> {
    return new TempDirStorage(await fs.mkdtemp(path.join(os.tmpdir(), 'urpmp-ai-')));
  }
  async save(key: string, data: Buffer): Promise<void> {
    const full = path.join(this.root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  read(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.root, key));
  }
  async remove(key: string): Promise<void> {
    await fs.rm(path.join(this.root, key), { force: true });
  }
  async dispose(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

/** Deletes everything (own throw-away test database only). */
export async function resetAiDb(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
}

export async function makeOwner() {
  return prisma.user.create({
    data: {
      email: `ai-${randomUUID()}@test.local`,
      passwordHash: 'not-a-real-hash',
      fullName: 'AI Test User',
      role: 'RESEARCHER',
    },
  });
}

export async function makeProject(ownerId: string, title = 'AI test project') {
  return prisma.project.create({ data: { ownerId, title, description: 'desc' } });
}

/** Saves bytes in storage and creates the matching documents row (status PENDING), like the upload endpoint would. */
export async function makeDocument(opts: {
  storage: TempDirStorage;
  projectId: string;
  uploadedById: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  status?: IngestionStatus;
}) {
  const storageKey = `${opts.projectId}/${randomUUID()}-${opts.fileName}`;
  await opts.storage.save(storageKey, opts.data);
  return prisma.document.create({
    data: {
      projectId: opts.projectId,
      uploadedById: opts.uploadedById,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: opts.data.length,
      storageKey,
      ingestionStatus: opts.status ?? 'PENDING',
    },
  });
}

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

// ───────────────────────── Fixture builders ─────────────────────────

/** PDF literal strings: escape backslash and parentheses; text must be latin1-encodable. */
const pdfEscape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/**
 * Builds a minimal valid PDF (Helvetica, one text line per page) with a correct xref table.
 * With `encrypted`, adds a standard-security-handler /Encrypt dictionary whose user password is NOT the empty
 * string, so a reader must ask for a password (the O/U values are bogus: we only need the "needs password" path).
 */
export function buildPdf(pages: string[], opts: { encrypted?: boolean } = {}): Buffer {
  const objs: string[] = [];
  const n = pages.length;
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const content = text ? `BT /F1 12 Tf 50 700 Td (${pdfEscape(text)}) Tj ET` : '';
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  const encryptId = objs.length;
  if (opts.encrypted) {
    const hex32 = '41'.repeat(32);
    objs[encryptId] = `<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -4 >>`;
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  const encrypt = opts.encrypted ? ` /Encrypt ${encryptId} 0 R /ID [<${'42'.repeat(16)}> <${'42'.repeat(16)}>]` : '';
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Builds a minimal valid .docx (one <w:p> per paragraph). */
export async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
