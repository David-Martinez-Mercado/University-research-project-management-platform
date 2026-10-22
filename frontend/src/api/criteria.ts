import { apiRequest } from './client';
import type { Criterion, CriterionInput } from './types';

export const listCriteria = (includeInactive = false) =>
  apiRequest<{ data: Criterion[] }>(`/criteria${includeInactive ? '?includeInactive=true' : ''}`).then((r) => r.data);

export const createCriterion = (input: CriterionInput) =>
  apiRequest<Criterion>('/criteria', { method: 'POST', body: input });

export const updateCriterion = (id: string, patch: Partial<CriterionInput>) =>
  apiRequest<Criterion>(`/criteria/${id}`, { method: 'PUT', body: patch });

/** Active criteria of a project the caller can see (judge, team, admin). */
export const getRubric = (projectId: string) =>
  apiRequest<{ projectId: string; data: Criterion[] }>(`/projects/${projectId}/rubric`).then((r) => r.data);
