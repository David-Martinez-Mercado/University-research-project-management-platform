import { apiDownload, apiRequest } from './client';
import type { DocumentType, ProjectDocument } from './types';

// Contract agreed with the backend module (see the Documents tab): multipart field `type` then `file`.

export const listDocuments = (projectId: string) =>
  apiRequest<{ data: ProjectDocument[] }>(`/projects/${projectId}/documents`).then((r) => r.data);

export function uploadDocument(projectId: string, file: File, type: DocumentType) {
  const form = new FormData();
  // `type` goes before the file so a streaming multipart parser has already seen it.
  form.append('type', type);
  form.append('file', file);
  return apiRequest<unknown>(`/projects/${projectId}/documents`, { method: 'POST', body: form });
}

/** The endpoint needs the bearer token, so the file is fetched as a Blob (not a bare link). */
export const downloadDocument = (projectId: string, documentId: string) =>
  apiDownload(`/projects/${projectId}/documents/${documentId}/download`);
