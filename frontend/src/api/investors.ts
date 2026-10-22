import { apiDownload, apiRequest } from './client';
import type { InvestorDashboard, InvestorLink, Page, ProjectStatus } from './types';

export interface DashboardParams {
  status?: ProjectStatus;
  researchArea?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function getInvestorDashboard(investorId: string, p: DashboardParams = {}) {
  const query = new URLSearchParams();
  if (p.status) query.set('status', p.status);
  if (p.researchArea) query.set('researchArea', p.researchArea);
  if (p.from) query.set('from', p.from);
  if (p.to) query.set('to', p.to);
  if (p.limit !== undefined) query.set('limit', String(p.limit));
  if (p.offset) query.set('offset', String(p.offset));
  const qs = query.toString();
  return apiRequest<InvestorDashboard>(`/investors/${investorId}/dashboard${qs ? `?${qs}` : ''}`);
}

export const downloadProjectReport = (projectId: string) => apiDownload(`/projects/${projectId}/report`);

export function listInvestorLinks(params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiRequest<Page<InvestorLink>>(`/investor-links${qs ? `?${qs}` : ''}`);
}

export const createInvestorLink = (investorId: string, projectId: string) =>
  apiRequest<InvestorLink>('/investor-links', { method: 'POST', body: { investorId, projectId } });

export const deleteInvestorLink = (id: string) => apiRequest<void>(`/investor-links/${id}`, { method: 'DELETE' });
