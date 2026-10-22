import { apiRequest } from './client';
import type { JudgeAssignment, Page } from './types';

export function listAssignments(params: { projectId?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.projectId) query.set('projectId', params.projectId);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiRequest<Page<JudgeAssignment>>(`/judge-assignments${qs ? `?${qs}` : ''}`);
}

export const createAssignment = (projectId: string, judgeId: string) =>
  apiRequest<JudgeAssignment>('/judge-assignments', { method: 'POST', body: { projectId, judgeId } });

export const deleteAssignment = (id: string) => apiRequest<void>(`/judge-assignments/${id}`, { method: 'DELETE' });
