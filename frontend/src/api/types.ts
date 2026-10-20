export const ROLES = ['INVESTOR', 'RESEARCHER', 'JUDGE', 'STUDENT', 'ADMINISTRATOR'] as const;
export type Role = (typeof ROLES)[number];

/** Public user shape returned by the backend (never includes password data). */
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  affiliation: string | null;
  isActive: boolean;
  isOwner: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  token: string;
  expiresInSeconds: number;
  user: User;
}

export interface FieldIssue {
  path: string;
  message: string;
}

/** Error body shapes produced by the backend (400 / 401 / 409 / 422 / 423 / 429 ...). */
export interface ErrorBody {
  error?: string;
  details?: FieldIssue[];
  retryAfterSeconds?: number;
  /** 422 on submit: required fields that are empty (e.g. ["title", "description"]). */
  missing?: string[];
  /** 409 on an invalid status transition. */
  from?: ProjectStatus;
  to?: ProjectStatus;
  allowed?: ProjectStatus[];
}

export const PROJECT_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_EVALUATION', 'EVALUATED', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Project as returned by /projects (see docs/PROJECTS.md). */
export interface Project {
  id: string;
  ownerId: string;
  title: string;
  summary: string | null;
  description: string | null;
  researchArea: string | null;
  affiliation: string | null;
  status: ProjectStatus;
  /** Statuses the lifecycle table allows next (not filtered by the caller's role). */
  allowedNextStatuses: ProjectStatus[];
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProjectInput {
  title: string;
  summary?: string;
  description?: string;
  researchArea?: string;
  affiliation?: string;
}

/** PUT /projects/:id accepts null to clear an optional field. */
export interface ProjectPatch {
  title?: string;
  summary?: string | null;
  description?: string | null;
  researchArea?: string | null;
  affiliation?: string | null;
}

export type CollaboratorRole = 'LEAD' | 'MEMBER';

export interface Collaborator {
  userId: string;
  fullName: string;
  email: string;
  userRole: Role;
  role: CollaboratorRole;
  /** The owner is an implicit LEAD and cannot be removed. */
  isOwner: boolean;
  addedAt: string;
}

export const DOCUMENT_TYPES = ['PROPOSAL', 'REPORT', 'DATASET', 'PUBLICATION', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type IngestionStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface ProjectDocument {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  type: DocumentType;
  ingestionStatus: IngestionStatus;
  uploadedAt: string;
  uploadedBy: { id: string; fullName: string };
}
