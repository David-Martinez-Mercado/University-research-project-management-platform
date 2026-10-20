import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import { documentParamsSchema, projectIdParamSchema } from './documents.schemas';
import { assertCanUpload, createDocument, getDocumentFile, listDocuments } from './documents.service';
import { receiveUpload } from './documents.upload';

/** Mounted at `/projects` (paths are `/:id/documents...`). */
export const documentsRouter = Router();

// Role gates only; which project the caller may touch is decided in the service, inside the query.
const UPLOAD_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT'] as const;
// INVESTOR is intentionally absent: investors never read raw documents.
const READ_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE'] as const;

documentsRouter.post(
  '/:id/documents',
  ...authorize({ roles: [...UPLOAD_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    await assertCanUpload(id, req.user!); // 404 / 409 before reading the body
    const received = await receiveUpload(req, res);
    res.status(201).json(await createDocument(id, received, req.user!));
  }),
);

documentsRouter.get(
  '/:id/documents',
  ...authorize({ roles: [...READ_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    res.json({ data: await listDocuments(id, req.user!) });
  }),
);

documentsRouter.get(
  '/:id/documents/:docId/download',
  ...authorize({ roles: [...READ_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id, docId } = documentParamsSchema.parse(req.params);
    const file = await getDocumentFile(id, docId, req.user!);
    const isText = file.mimeType.startsWith('text/');
    res.setHeader('Content-Type', isText ? `${file.mimeType}; charset=utf-8` : file.mimeType);
    res.setHeader('Content-Length', String(file.bytes.length));
    res.setHeader('Content-Disposition', contentDisposition(file.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(file.bytes);
  }),
);

/** RFC 6266 / 5987: ASCII fallback plus UTF-8 `filename*`. The name is already sanitized. */
function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
