import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { User } from '../api/types';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';

export const TEST_USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'rita@example.edu',
  fullName: 'Rita Researcher',
  role: 'RESEARCHER',
  affiliation: 'Test University',
  isActive: true,
  isOwner: false,
  lastLoginAt: '2026-10-16T10:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Replaces global fetch (the real API client path - not the src/mocks/ layer) with a stub. */
export function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}
