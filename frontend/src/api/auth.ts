import { apiRequest } from './client';
import type { LoginResponse, User } from './types';

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    authenticated: false,
  });
}

export function getMe(): Promise<User> {
  return apiRequest<User>('/auth/me');
}
