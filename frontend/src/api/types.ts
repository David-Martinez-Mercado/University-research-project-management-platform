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

export interface Criterion {
  id: string;
  name: string;
  description: string | null;
  maxScore: number;
  weight: number;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CriterionInput {
  name: string;
  description?: string | null;
  maxScore?: number;
  weight?: number;
  position?: number;
  isActive?: boolean;
}

export type AssignmentStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';

export interface JudgeAssignment {
  id: string;
  projectId: string;
  judgeId: string;
  assignedById: string;
  status: AssignmentStatus;
  assignedAt: string;
  completedAt: string | null;
  judge: { id: string; fullName: string; email: string; affiliation: string | null };
  project: { id: string; title: string; status: ProjectStatus };
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  affiliation?: string;
}

export interface UserPatch {
  fullName?: string;
  role?: Role;
  affiliation?: string | null;
  isActive?: boolean;
  password?: string;
  unlockAccount?: true;
}

// ---- Notifications ----
export type NotificationType =
  | 'PROJECT_STATUS'
  | 'JUDGE_ASSIGNED'
  | 'EVALUATION_SUBMITTED'
  | 'DOCUMENT_UPLOADED'
  | 'COLLABORATOR_ADDED'
  | 'SYSTEM';

export interface AppNotification {
  id: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage extends Page<AppNotification> {
  unread: number;
}

// ---- Milestones / progress ----
export interface Milestone {
  id: string;
  title: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface MilestoneList {
  data: Milestone[];
  progressPercent: number;
}

// ---- Evaluation (judge) ----
export interface EvaluationCriterionState {
  criterionId: string;
  name: string;
  description: string | null;
  maxScore: number;
  weight: number;
  score: number | null;
  comments: string | null;
}

export interface MyEvaluation {
  projectId: string;
  project: { id: string; title: string; status: ProjectStatus };
  assignment: { id: string; status: AssignmentStatus; completedAt: string | null };
  state: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED';
  canEdit: boolean;
  criteria: EvaluationCriterionState[];
  projectClosed?: boolean;
}

export interface EvaluationScoreInput {
  criterionId: string;
  score?: number | null;
  comments?: string | null;
}

export interface ResultsCriterion {
  criterionId: string;
  name: string;
  maxScore: number;
  weight: number;
  average: number | null;
  comments: Array<{ judge: string | null; comment: string }>;
}

export interface ProjectResults {
  projectId: string;
  status: ProjectStatus;
  closed: boolean;
  judgesAssigned: number;
  judgesCompleted: number;
  results: null | {
    overallPercent: number | null;
    criteria: ResultsCriterion[];
    byJudge?: Array<{ judge: string; criterionId: string; score: number | null }>;
  };
}

// ---- Investors ----
export interface InvestorLink {
  id: string;
  investorId: string;
  projectId: string;
  createdAt: string;
  investor: { id: string; fullName: string; email: string };
  project: { id: string; title: string; status: ProjectStatus };
}

export interface InvestorProject {
  id: string;
  title: string;
  summary: string | null;
  researchArea: string | null;
  status: ProjectStatus;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  progressPercent: number;
  milestones: Milestone[];
  evaluation: { judgesAssigned: number; judgesCompleted: number; closed: boolean; overallPercent: number | null };
}

export interface InvestorDashboard extends Page<InvestorProject> {
  investorId: string;
  summary: {
    totalLinked: number;
    byStatus: Partial<Record<ProjectStatus, number>>;
    researchAreas: string[];
  };
}

// ---- AI assistant ----
export interface AiSource {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  pageNumber: number | null;
  similarity: number;
  excerpt: string;
}

export interface AiExchange {
  interactionId: string;
  question: string;
  answer: string | null;
  /** Set when the assistant refused for lack of relevant information (AIR-004). */
  message: string | null;
  fallback: boolean;
  flagged: boolean;
  createdAt?: string;
  sources: AiSource[];
}

export interface AiInteractionRow {
  id: string;
  user: string;
  project: { id: string; title: string } | null;
  question: string;
  answer: string | null;
  fallback: boolean;
  flagged: boolean;
  confidence: number | null;
  latencyMs: number | null;
  model: string | null;
  createdAt: string;
}
