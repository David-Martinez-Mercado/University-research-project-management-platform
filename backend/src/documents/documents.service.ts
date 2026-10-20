import { randomUUID } from 'node:crypto';
import type { Prisma, ProjectStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { visibleProjectsWhere } from '../projects/projects.scope';
import { validateUpload } from './documents.content';
import { emitDocumentUploaded } from './documents.events';
import { uploadFieldsSchema } from './documents.schemas';
import type { ReceivedFile } from './documents.upload';
import { getStorage } from './storage';

/** Uploads are accepted only while the project can still change. */
export const UPLOADABLE_STATUSES: readonly ProjectStatus[] = ['DRAFT', 'SUBMITTED'];

const documentInclude = { uploadedBy: { select: { id: true, fullName: true } } } satisfies Prisma.DocumentInclude;
type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

/** Shape returned by the API. */
export function toPublicDocument(d: DocumentRow) {
  return {
    id: d.id,
    projectId: d.projectId,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: Number(d.sizeBytes),
    type: d.type,
    ingestionStatus: d.ingestionStatus,
    uploadedAt: d.uploadedAt,
    uploadedBy: d.uploadedBy,
  };
}

/** Visibility is part of the WHERE clause (BR-007 pattern): invisible and missing → 404. */
async function loadVisibleProject(projectId: string, user: AuthUser, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const project = await db.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: { id: true, status: true },
  });
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

function assertUploadable(status: ProjectStatus) {
  if (!UPLOADABLE_STATUSES.includes(status)) {
    throw new HttpError(409, `Project is ${status}; documents can only be uploaded while it is DRAFT or SUBMITTED`);
  }
}

/**
 * Cheap pre-check run BEFORE the request body is read, so callers who may not upload do not
 * make the server buffer a file. Re-validated inside the transaction by createDocument().
 */
export async function assertCanUpload(projectId: string, user: AuthUser): Promise<void> {
  const project = await loadVisibleProject(projectId, user);
  assertUploadable(project.status);
}

export async function createDocument(
  projectId: string,
  received: { file?: ReceivedFile; fields: Record<string, unknown> },
  user: AuthUser,
) {
  if (!received.file) {
    throw new HttpError(400, "A file is required: send multipart/form-data with the file in the field 'file'");
  }
  const fields = uploadFieldsSchema.parse(received.fields);
  const validated = validateUpload(received.file.originalName, received.file.buffer);

  // Server-generated key: the client controls neither the directory nor the file name on disk.
  const storageKey = `projects/${projectId}/${randomUUID()}`;
  const storage = getStorage();
  await storage.save(storageKey, received.file.buffer);

  let row: DocumentRow;
  try {
    row = await prisma.$transaction(async (tx) => {
      // Share-lock the project row: a concurrent status change (UPDATE) waits for this
      // transaction, so a document cannot slip into a project that just left DRAFT/SUBMITTED.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR SHARE`;
      const project = await loadVisibleProject(projectId, user, tx);
      assertUploadable(project.status);

      return tx.document.create({
        data: {
          projectId,
          uploadedById: user.id,
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          sizeBytes: BigInt(received.file!.buffer.length),
          type: fields.type,
          storageKey,
          ingestionStatus: 'PENDING',
        },
        include: documentInclude,
      });
    });
  } catch (err) {
    await storage.remove(storageKey).catch(() => undefined); // no orphan bytes if the row was not created
    throw err;
  }

  // Row committed AND bytes saved: now the AI ingestion listener may run. A misbehaving
  // listener must never turn a successful upload into an error response.
  try {
    emitDocumentUploaded({ documentId: row.id, projectId });
  } catch (err) {
    console.error('document.uploaded listener threw:', err);
  }
  return toPublicDocument(row);
}

export async function listDocuments(projectId: string, user: AuthUser) {
  await loadVisibleProject(projectId, user);
  const rows = await prisma.document.findMany({
    where: { projectId },
    include: documentInclude,
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toPublicDocument);
}

export async function getDocumentFile(projectId: string, documentId: string, user: AuthUser) {
  await loadVisibleProject(projectId, user);
  // Filtering by projectId as well prevents reading a document of another project through this URL.
  const doc = await prisma.document.findFirst({ where: { id: documentId, projectId } });
  if (!doc) throw new HttpError(404, 'Document not found');

  let bytes: Buffer;
  try {
    bytes = await getStorage().read(doc.storageKey);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, 'The stored file is no longer available');
    }
    throw err;
  }
  return { fileName: doc.fileName, mimeType: doc.mimeType, bytes };
}
