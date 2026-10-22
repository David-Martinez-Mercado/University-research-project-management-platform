import { apiRequest } from './client';
import type { CreateUserInput, Page, Role, User, UserPatch } from './types';

export interface UserListParams {
  role?: Role;
  q?: string;
  limit?: number;
  offset?: number;
}

export function listUsers({ role, q, limit, offset }: UserListParams = {}): Promise<Page<User>> {
  const query = new URLSearchParams();
  if (role) query.set('role', role);
  if (q) query.set('q', q);
  if (limit !== undefined) query.set('limit', String(limit));
  if (offset) query.set('offset', String(offset));
  const qs = query.toString();
  return apiRequest<Page<User>>(`/users${qs ? `?${qs}` : ''}`);
}

export const createUser = (input: CreateUserInput) => apiRequest<User>('/users', { method: 'POST', body: input });

export const updateUser = (id: string, patch: UserPatch) =>
  apiRequest<User>(`/users/${id}`, { method: 'PUT', body: patch });
