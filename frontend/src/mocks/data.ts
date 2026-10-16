// MOCK DATA - used only when VITE_USE_MOCKS=true. Never imported by the real API path.
import type { User } from '../api/types';

export const MOCK_PASSWORD = 'mock-password-1';

export const MOCK_LOCKED_EMAIL = 'locked@mock.test';
export const MOCK_LOCKED_RETRY_SECONDS = 9 * 60;

/** Accounts that can sign in with MOCK_PASSWORD. */
export const MOCK_USERS: User[] = [
  ['researcher@mock.test', 'Rita Researcher', 'RESEARCHER'],
  ['student@mock.test', 'Sam Student', 'STUDENT'],
  ['judge@mock.test', 'Jules Judge', 'JUDGE'],
  ['investor@mock.test', 'Ines Investor', 'INVESTOR'],
  ['admin@mock.test', 'Ada Admin', 'ADMINISTRATOR'],
].map(([email, fullName, role], i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  email,
  fullName,
  role: role as User['role'],
  affiliation: 'Mock University',
  isActive: true,
  isOwner: role === 'ADMINISTRATOR',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}));
