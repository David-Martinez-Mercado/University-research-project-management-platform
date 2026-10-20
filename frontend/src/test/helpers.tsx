import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ROLES, type Collaborator, type Project, type ProjectDocument, type Role, type User } from '../api/types';
import { tokenStore } from '../auth/tokenStore';
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

export function makeUser(role: Role, overrides: Partial<User> = {}): User {
  return {
    ...TEST_USER,
    // RESEARCHER is TEST_USER (the default project owner); every other role gets its own stable id.
    id: role === 'RESEARCHER' ? TEST_USER.id : `00000000-0000-4000-8000-0000000001${String(ROLES.indexOf(role)).padStart(2, '0')}`,
    email: `${role.toLowerCase()}@example.edu`,
    fullName: `Test ${role}`,
    role,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: TEST_USER.id,
    title: 'Proyecto de prueba',
    summary: 'Resumen de prueba',
    description: 'Descripción de prueba',
    researchArea: 'Biología',
    affiliation: 'Test University',
    status: 'DRAFT',
    allowedNextStatuses: ['SUBMITTED'],
    submittedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

export function makeCollaborator(overrides: Partial<Collaborator> = {}): Collaborator {
  return {
    userId: TEST_USER.id,
    fullName: TEST_USER.fullName,
    email: TEST_USER.email,
    userRole: 'RESEARCHER',
    role: 'LEAD',
    isOwner: true,
    addedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

export function makeDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: makeProject().id,
    fileName: 'propuesta.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    type: 'PROPOSAL',
    ingestionStatus: 'READY',
    uploadedAt: '2026-10-03T10:00:00.000Z',
    uploadedBy: { id: TEST_USER.id, fullName: TEST_USER.fullName },
    ...overrides,
  };
}

export type RouteHandler = (request: { url: URL; init: RequestInit | undefined }) => Response | Promise<Response>;

/**
 * Routes the stubbed global fetch by "METHOD /path" (query ignored). A handler may be a Response
 * (reused for every call) or a function. Unmatched requests answer 500 so a missing route fails loudly.
 * Returns the fetch mock so tests can inspect calls.
 */
export function stubApi(routes: Record<string, RouteHandler | Response | (() => Response)>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const route = routes[key];
    if (!route) return jsonResponse(500, { error: `No test route for ${key}` });
    if (route instanceof Response) return route.clone();
    return (route as RouteHandler)({ url, init });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Signs the given user in by seeding the token and answering GET /auth/me. */
export function signedInAs(user: User, routes: Parameters<typeof stubApi>[0] = {}) {
  tokenStore.set('jwt-test');
  return stubApi({ 'GET /auth/me': () => jsonResponse(200, user), ...routes });
}

export function callsTo(fetchMock: ReturnType<typeof stubApi>, key: string) {
  return fetchMock.mock.calls.filter(([input, init]) => `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}` === key);
}
