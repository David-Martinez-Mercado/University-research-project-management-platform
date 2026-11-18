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

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  affiliation?: string;
}

/** Public signup: always creates a USER (the server rejects any `role`). Returns a session like login. */
export function register(input: RegisterInput): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/register', { method: 'POST', body: input, authenticated: false });
}
