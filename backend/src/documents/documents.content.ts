import { HttpError } from '../errors';

/**
 * Upload validation BY CONTENT. The client-declared MIME type is never trusted; the extension
 * is only accepted if the bytes really are what the extension claims.
 */

export type DetectedKind = 'pdf' | 'docx' | 'text';

/** Allowed extensions → the content kind they must have. */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, DetectedKind>> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'text',
  md: 'text',
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** MIME type stored for a document: derived on the server from the validated extension. */
export function mimeFor(extension: string): string {
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return DOCX_MIME;
    case 'md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}

// ---- File name ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 200;

/**
 * Normalizes the display name: no directory components (either separator), no control /
 * format characters (NULs, bidi overrides, zero-width), no characters that are troublesome
 * in headers or on common filesystems. The name is NEVER used to build a storage path.
 */
export function sanitizeFileName(raw: string): string {
  let name = raw.normalize('NFC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/\s/g, ' '); // whitespace (tabs, line breaks...) becomes a space; other controls vanish
  name = name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '');
  name = name.replace(/[<>:"|?*]/g, '_');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');

  const chars = Array.from(name);
  if (chars.length > MAX_NAME_LENGTH) {
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(name)?.[0] ?? '';
    name = chars.slice(0, MAX_NAME_LENGTH - ext.length).join('') + ext;
  }
  return name;
}

export function extensionOf(name: string): string | undefined {
  return /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase();
}

// ---- Content detection -------------------------------------------------------------------

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isPdf(buf: Buffer): boolean {
  return buf.length > PDF_MAGIC.length && buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

function isUtf8TextWithoutNul(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

const MAX_ZIP_ENTRIES = 10_000;
// Guards the downstream text extractor against zip bombs: compressed size is capped by the
// upload limit, but the declared UNCOMPRESSED total is cheap to read from the central directory.
const MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/**
 * Lists entry names from the ZIP central directory WITHOUT decompressing anything.
 * Returns null for anything malformed, truncated, ZIP64 or implausible.
 */
export function readZipEntries(buf: Buffer): { names: string[]; totalUncompressed: number } | null {
  const EOCD_MIN = 22;
  if (buf.length < EOCD_MIN) return null;

  let eocd = -1;
  const lowest = Math.max(0, buf.length - EOCD_MIN - 0xffff);
  for (let i = buf.length - EOCD_MIN; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // ZIP64
  if (entryCount > MAX_ZIP_ENTRIES || cdOffset + cdSize > eocd) return null;

  const names: string[] = [];
  let total = 0;
  let pos = cdOffset;
  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const uncompressed = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const end = pos + 46 + nameLen + extraLen + commentLen;
    if (end > buf.length) return null;
    names.push(buf.toString('utf8', pos + 46, pos + 46 + nameLen));
    total += uncompressed;
    pos = end;
  }
  return { names, totalUncompressed: total };
}

function isDocx(buf: Buffer): boolean {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_LOCAL_HEADER)) return false;
  const zip = readZipEntries(buf);
  if (!zip || zip.totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) return false;
  return zip.names.includes('[Content_Types].xml') && zip.names.includes('word/document.xml');
}

export interface ValidatedUpload {
  /** Sanitized display name. */
  fileName: string;
  extension: string;
  mimeType: string;
}

/**
 * Validates name + bytes. Throws HttpError (415 unsupported/mismatching content, 400 empty).
 * Nothing is persisted before this succeeds.
 */
export function validateUpload(originalName: string, data: Buffer): ValidatedUpload {
  if (data.length === 0) throw new HttpError(400, 'The uploaded file is empty');

  const fileName = sanitizeFileName(originalName);
  const extension = extensionOf(fileName);
  const expected = extension ? ALLOWED_EXTENSIONS[extension] : undefined;
  if (!extension || !expected) {
    throw new HttpError(415, `Unsupported file type; allowed extensions: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`);
  }

  const ok =
    expected === 'pdf' ? isPdf(data) : expected === 'docx' ? isDocx(data) : isUtf8TextWithoutNul(data);
  if (!ok) {
    throw new HttpError(415, `File content does not match its .${extension} extension`);
  }

  return { fileName, extension, mimeType: mimeFor(extension) };
}
