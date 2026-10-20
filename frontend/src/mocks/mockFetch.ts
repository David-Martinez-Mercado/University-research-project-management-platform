// MOCK API - only bundled when VITE_USE_MOCKS=true.
//
// It simulates ONLY what the real backend cannot serve yet: the documents endpoints
//   GET  /projects/:id/documents
//   POST /projects/:id/documents            (multipart: type, file)
//   GET  /projects/:id/documents/:docId/download
// Everything else (/auth/*, /projects/*, collaborators) is passed straight to the real network, so the
// session and project data are real. Delete this folder and the flag once the documents backend ships.
import type { DocumentType, IngestionStatus, ProjectDocument } from '../api/types';

const LATENCY_MS = 300;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'docx', 'txt', 'md'];
const TYPES: DocumentType[] = ['PROPOSAL', 'REPORT', 'DATASET', 'PUBLICATION', 'OTHER'];

interface StoredDoc extends ProjectDocument {
  /** Mock ingestion advances with time: PENDING -> PROCESSING -> READY. */
  createdMs: number;
  content: ArrayBuffer;
}

/** In-memory only: reloading the page clears every mocked document. */
const store = new Map<string, StoredDoc[]>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function ingestionStatus(doc: StoredDoc): IngestionStatus {
  const age = Date.now() - doc.createdMs;
  if (age < 3000) return 'PENDING';
  if (age < 6000) return 'PROCESSING';
  return 'READY';
}

function publicDoc(doc: StoredDoc): ProjectDocument {
  const { createdMs: _c, content: _b, ...rest } = doc;
  void _c;
  void _b;
  return { ...rest, ingestionStatus: ingestionStatus(doc) };
}

/** Best-effort id of the caller from the JWT payload (the mock never validates the token). */
function callerId(authorization: string | null): string {
  try {
    const payload = authorization?.replace(/^Bearer\s+/i, '').split('.')[1] ?? '';
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { id?: string; sub?: string };
    return data.id ?? data.sub ?? 'mock-user';
  } catch {
    return 'mock-user';
  }
}

async function upload(projectId: string, body: BodyInit | null | undefined, authorization: string | null) {
  if (!(body instanceof FormData)) return json(400, { error: 'Expected multipart/form-data' });
  const file = body.get('file');
  const type = body.get('type');
  if (!(file instanceof File)) return json(400, { error: 'Missing file' });
  if (typeof type !== 'string' || !TYPES.includes(type as DocumentType)) {
    return json(400, { error: 'Validation failed', details: [{ path: 'type', message: 'Invalid enum value' }] });
  }
  if (file.size > MAX_BYTES) return json(413, { error: 'Payload too large' });
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXT.includes(ext)) return json(415, { error: `Unsupported file type; allowed extensions: ${ALLOWED_EXT.join(', ')}` });

  const doc: StoredDoc = {
    id: crypto.randomUUID(),
    projectId,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    type: type as DocumentType,
    ingestionStatus: 'PENDING',
    uploadedAt: new Date().toISOString(),
    uploadedBy: { id: callerId(authorization), fullName: 'Tú (simulado)' },
    createdMs: Date.now(),
    content: await file.arrayBuffer(),
  };
  store.set(projectId, [doc, ...(store.get(projectId) ?? [])]);
  return json(201, publicDoc(doc));
}

export const mockFetch: typeof fetch = async (input, init) => {
  const { pathname } = new URL(String(input));
  const match = /^\/projects\/([^/]+)\/documents(?:\/([^/]+)\/download)?$/.exec(pathname);
  if (!match) return fetch(input, init); // not mocked: real network

  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const [, projectId, docId] = match;
  const method = init?.method ?? 'GET';
  const authorization = new Headers(init?.headers).get('Authorization');

  if (docId && method === 'GET') {
    const doc = store.get(projectId)?.find((d) => d.id === docId);
    if (!doc) return json(404, { error: 'Document not found' });
    return new Response(doc.content, { status: 200, headers: { 'Content-Type': doc.mimeType } });
  }
  if (!docId && method === 'GET') return json(200, { data: (store.get(projectId) ?? []).map(publicDoc) });
  if (!docId && method === 'POST') return upload(projectId, init?.body, authorization);
  return json(404, { error: 'Not found' });
};
