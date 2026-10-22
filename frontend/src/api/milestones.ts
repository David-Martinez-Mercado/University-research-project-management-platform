import { apiRequest } from './client';
import type { MilestoneList } from './types';

export const listMilestones = (projectId: string) => apiRequest<MilestoneList>(`/projects/${projectId}/milestones`);

export const addMilestone = (projectId: string, title: string, dueDate: string | null) =>
  apiRequest<MilestoneList>(`/projects/${projectId}/milestones`, { method: 'POST', body: { title, dueDate } });

export const setMilestoneCompleted = (projectId: string, id: string, completed: boolean) =>
  apiRequest<MilestoneList>(`/projects/${projectId}/milestones/${id}`, { method: 'PUT', body: { completed } });

export const deleteMilestone = (projectId: string, id: string) =>
  apiRequest<void>(`/projects/${projectId}/milestones/${id}`, { method: 'DELETE' });
