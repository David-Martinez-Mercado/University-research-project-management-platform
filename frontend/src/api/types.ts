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

/** Error body shapes produced by the backend (400 / 401 / 423 / 429 ...). */
export interface ErrorBody {
  error?: string;
  details?: FieldIssue[];
  retryAfterSeconds?: number;
}
