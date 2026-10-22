import { apiRequest } from './client';
import type { AiExchange, AiInteractionRow, Page } from './types';

export const askAssistant = (projectId: string, question: string) =>
  apiRequest<Omit<AiExchange, 'question' | 'flagged'> & { aiGenerated: boolean; confidence: number }>(
    `/projects/${projectId}/ask`,
    { method: 'POST', body: { question } },
  );

export const listAiHistory = (projectId: string) =>
  apiRequest<{ data: AiExchange[] }>(`/projects/${projectId}/ai-history`).then((r) => r.data);

export const flagAnswer = (interactionId: string) =>
  apiRequest<{ flagged: boolean }>(`/ai/interactions/${interactionId}/flag`, { method: 'POST' });

export function listAiInteractions(params: { flagged?: boolean; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.flagged !== undefined) query.set('flagged', String(params.flagged));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiRequest<Page<AiInteractionRow>>(`/ai/interactions${qs ? `?${qs}` : ''}`);
}
