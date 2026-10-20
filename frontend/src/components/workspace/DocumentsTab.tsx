import { useEffect, useState, type FormEvent } from 'react';
import { downloadDocument, listDocuments, uploadDocument } from '../../api/documents';
import { DOCUMENT_TYPES, type DocumentType, type ProjectDocument } from '../../api/types';
import { describeError, MAX_UPLOAD_MB, UPLOAD_CLOSED } from '../../lib/errors';
import { DOCUMENT_TYPE_LABELS, formatBytes, formatDateTime } from '../../lib/labels';
import { PROJECT_TEAM_ROLES } from '../../lib/roles';
import { saveBlob } from '../../lib/saveBlob';
import { useAsync } from '../../lib/useAsync';
import { IngestionBadge } from '../badges';
import { Alert, Button, Card, EmptyState, Input, Select, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'];
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const POLL_MS = 4000;

/** Client-side hint only; the server validates type and size and is the authority. */
function fileHint(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const problems: string[] = [];
  if (!ALLOWED_EXTENSIONS.includes(ext)) problems.push('su formato no es PDF, DOCX, TXT ni MD');
  if (file.size > MAX_BYTES) problems.push(`pesa más de ${MAX_UPLOAD_MB} MB`);
  return problems.length
    ? `Este archivo probablemente será rechazado: ${problems.join(' y ')}. El servidor tiene la última palabra.`
    : null;
}

export function DocumentsTab({ project, role }: WorkspaceContext) {
  const docs = useAsync(() => listDocuments(project.id), [project.id]);
  const isTeam = PROJECT_TEAM_ROLES.includes(role);
  // The backend accepts uploads only while the project is DRAFT or SUBMITTED (it answers 409 otherwise).
  const uploadOpen = project.status === 'DRAFT' || project.status === 'SUBMITTED';
  const canUpload = isTeam && uploadOpen;

  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<DocumentType>('PROPOSAL');
  const [fileKey, setFileKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Ingestion runs in the background: refresh the list while any document is still being processed.
  const inFlight = docs.data?.some((d) => d.ingestionStatus === 'PENDING' || d.ingestionStatus === 'PROCESSING');
  const { reload } = docs;
  useEffect(() => {
    if (!inFlight) return;
    const timer = setTimeout(reload, POLL_MS);
    return () => clearTimeout(timer);
  }, [inFlight, docs.data, reload]);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!file) {
      setUploadError('Selecciona un archivo para subir.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      await uploadDocument(project.id, file, type);
      setNotice(`"${file.name}" se subió correctamente. Se está procesando para el asistente de IA.`);
      setFile(null);
      setFileKey((k) => k + 1);
      docs.reload();
    } catch (err) {
      setUploadError(describeError(err, 'document-upload'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: ProjectDocument) {
    setDownloadError(null);
    setDownloadingId(doc.id);
    try {
      saveBlob(await downloadDocument(project.id, doc.id), doc.fileName);
    } catch (err) {
      setDownloadError(`No se pudo descargar "${doc.fileName}". ${describeError(err, 'document-download')}`);
    } finally {
      setDownloadingId(null);
    }
  }

  const hint = file ? fileHint(file) : null;

  return (
    <div className="space-y-6">
      {isTeam && !uploadOpen && <Alert tone="info">{UPLOAD_CLOSED}</Alert>}
      {canUpload && (
        <Card title="Subir documento" description={`Formatos: PDF, DOCX, TXT y MD. Máximo ${MAX_UPLOAD_MB} MB por archivo.`}>
          <form onSubmit={handleUpload} noValidate className="space-y-4">
            {uploadError && <Alert tone="error">{uploadError}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Tipo de documento"
                value={type}
                onChange={(e) => setType(e.target.value as DocumentType)}
                disabled={uploading}
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Input
                key={fileKey}
                label="Archivo"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                disabled={uploading}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setUploadError(null);
                  setNotice(null);
                }}
              />
            </div>
            {hint && <Alert tone="info">{hint}</Alert>}
            <Button type="submit" loading={uploading}>
              {uploading ? 'Subiendo...' : 'Subir documento'}
            </Button>
          </form>
        </Card>
      )}

      <section aria-label="Documentos del proyecto" aria-busy={docs.loading} className="space-y-3">
        <h2 className="text-lg font-semibold">Documentos</h2>
        <div aria-live="polite">{downloadError && <Alert tone="error">{downloadError}</Alert>}</div>
        {docs.error ? (
          <div className="space-y-3">
            <Alert tone="error">{describeError(docs.error)}</Alert>
            <Button variant="secondary" onClick={docs.reload}>
              Reintentar
            </Button>
          </div>
        ) : !docs.data ? (
          <Spinner label="Cargando documentos..." />
        ) : docs.data.length === 0 ? (
          <EmptyState
            title="Aún no hay documentos"
            description={isTeam && uploadOpen ? 'Sube la propuesta u otros archivos del proyecto con el formulario de arriba.' : undefined}
          />
        ) : (
          <ul className="space-y-3">
            {docs.data.map((doc) => (
              <li key={doc.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold">{doc.fileName}</p>
                      <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                        <div className="flex gap-1">
                          <dt>Tipo:</dt>
                          <dd className="text-slate-800">{DOCUMENT_TYPE_LABELS[doc.type]}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>Tamaño:</dt>
                          <dd className="text-slate-800">{formatBytes(doc.sizeBytes)}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>Subido por:</dt>
                          <dd className="text-slate-800">{doc.uploadedBy.fullName}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>Fecha:</dt>
                          <dd className="text-slate-800">{formatDateTime(doc.uploadedAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-600">Procesamiento:</span>
                      <IngestionBadge status={doc.ingestionStatus} />
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={downloadingId === doc.id}
                        disabled={downloadingId !== null}
                        aria-label={`Descargar ${doc.fileName}`}
                        onClick={() => handleDownload(doc)}
                      >
                        Descargar
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
