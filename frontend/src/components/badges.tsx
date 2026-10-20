import type { IngestionStatus, ProjectStatus } from '../api/types';
import { INGESTION_LABELS, STATUS_LABELS } from '../lib/labels';
import { Badge, type BadgeTone } from './ui';

const STATUS_TONES: Record<ProjectStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_EVALUATION: 'warning',
  EVALUATED: 'success',
  ARCHIVED: 'neutral',
};

const INGESTION_TONES: Record<IngestionStatus, BadgeTone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  READY: 'success',
  FAILED: 'danger',
};

/** The label text is always shown; color is only a reinforcement. */
export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function IngestionBadge({ status }: { status: IngestionStatus }) {
  return <Badge tone={INGESTION_TONES[status]}>{INGESTION_LABELS[status]}</Badge>;
}
