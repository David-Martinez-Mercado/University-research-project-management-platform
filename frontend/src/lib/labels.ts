import type {
  CollaboratorRole,
  DocumentType,
  IngestionStatus,
  ProjectStatus,
} from '../api/types';

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviado',
  UNDER_EVALUATION: 'En evaluación',
  EVALUATED: 'Evaluado',
  ARCHIVED: 'Archivado',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PROPOSAL: 'Propuesta',
  REPORT: 'Informe',
  DATASET: 'Conjunto de datos',
  PUBLICATION: 'Publicación',
  OTHER: 'Otro',
};

export const INGESTION_LABELS: Record<IngestionStatus, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'Procesando',
  READY: 'Listo',
  FAILED: 'Falló',
};

export const COLLABORATOR_ROLE_LABELS: Record<CollaboratorRole, string> = {
  LEAD: 'Líder',
  MEMBER: 'Miembro',
};

export const FIELD_LABELS: Record<string, string> = {
  title: 'título',
  summary: 'resumen',
  description: 'descripción',
  researchArea: 'área de investigación',
  affiliation: 'afiliación',
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
