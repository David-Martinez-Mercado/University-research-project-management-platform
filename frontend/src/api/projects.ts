import { apiRequest } from './client';
import type {
  Collaborator,
  CollaboratorRole,
  Page,
  Project,
  ProjectInput,
  ProjectPatch,
  ProjectStatus,
} from './types';

export interface ListParams {
  status?: ProjectStatus;
  limit?: number;
  offset?: number;
}

/** GET /projects is already scoped to the caller's role by the backend; the client never filters. */
export function listProjects({ status, limit, offset }: ListParams = {}): Promise<Page<Project>> {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (limit !== undefined) query.set('limit', String(limit));
  if (offset) query.set('offset', String(offset));
  const qs = query.toString();
  return apiRequest<Page<Project>>(`/projects${qs ? `?${qs}` : ''}`);
}

export const getProject = (id: string) => apiRequest<Project>(`/projects/${id}`);

export const createProject = (input: ProjectInput) =>
  apiRequest<Project>('/projects', { method: 'POST', body: input });

export const updateProject = (id: string, patch: ProjectPatch) =>
  apiRequest<Project>(`/projects/${id}`, { method: 'PUT', body: patch });

export const changeProjectStatus = (id: string, status: ProjectStatus) =>
  apiRequest<Project>(`/projects/${id}/status`, { method: 'PUT', body: { status } });

export const listCollaborators = (projectId: string) =>
  apiRequest<{ data: Collaborator[] }>(`/projects/${projectId}/collaborators`).then((r) => r.data);

/** Returns the full, updated collaborator list. */
export const addCollaborator = (projectId: string, userId: string, role: CollaboratorRole) =>
  apiRequest<{ data: Collaborator[] }>(`/projects/${projectId}/collaborators`, {
    method: 'POST',
    body: { userId, role },
  }).then((r) => r.data);

export const removeCollaborator = (projectId: string, userId: string) =>
  apiRequest<void>(`/projects/${projectId}/collaborators/${userId}`, { method: 'DELETE' });
