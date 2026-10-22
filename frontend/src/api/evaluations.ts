import { apiRequest } from './client';
import type { EvaluationScoreInput, MyEvaluation, ProjectResults } from './types';

export const getMyEvaluation = (projectId: string) => apiRequest<MyEvaluation>(`/projects/${projectId}/evaluation`);

export const saveEvaluation = (projectId: string, scores: EvaluationScoreInput[], submit: boolean) =>
  apiRequest<MyEvaluation>('/evaluations', { method: 'POST', body: { projectId, scores, submit } });

export const getResults = (projectId: string) => apiRequest<ProjectResults>(`/projects/${projectId}/results`);
