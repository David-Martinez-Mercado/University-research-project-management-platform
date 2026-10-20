import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config/env';
import { HttpError } from '../errors';

export interface ReceivedFile {
  originalName: string;
  buffer: Buffer;
}

/**
 * Parses ONE multipart file (field `file`) into memory, bounded by MAX_UPLOAD_MB.
 * Every multer / busboy failure is turned into an HttpError (413 for size, 400 otherwise),
 * so the shared error handler answers with clean JSON and never a 500.
 * The limit is read per request so the configured value is always the effective one.
 */
export function receiveUpload(req: Request, res: Response): Promise<{ file?: ReceivedFile; fields: Record<string, unknown> }> {
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8', // browsers send raw UTF-8 file names
    limits: {
      fileSize: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
      files: 1,
      fields: 5,
      fieldSize: 1024,
      parts: 7,
    },
  }).single('file');

  return new Promise((resolve, reject) => {
    upload(req, res, (err: unknown) => {
      if (err) return reject(mapUploadError(err));
      resolve({
        file: req.file ? { originalName: req.file.originalname, buffer: req.file.buffer } : undefined,
        fields: { ...(req.body as Record<string, unknown> | undefined) },
      });
    });
  });
}

function mapUploadError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new HttpError(413, `File too large; the maximum size is ${env.MAX_UPLOAD_MB} MB`);
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return new HttpError(400, "Send exactly one file in the multipart field named 'file'");
      default:
        return new HttpError(400, `Invalid upload: ${err.message}`);
    }
  }
  // busboy: malformed / truncated multipart body, missing boundary, aborted request...
  return new HttpError(400, 'Malformed multipart/form-data body');
}
