// MOCK API - a drop-in replacement for `fetch` that only exists when VITE_USE_MOCKS=true.
// It mirrors the real backend's contract for POST /auth/login and GET /auth/me, including
// the sliding-session X-Auth-Token header and the 400 / 401 / 423 error shapes.
import {
  MOCK_LOCKED_EMAIL,
  MOCK_LOCKED_RETRY_SECONDS,
  MOCK_PASSWORD,
  MOCK_USERS,
} from './data';

const TOKEN_PREFIX = 'mock-token.';
const LATENCY_MS = 300;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const newToken = (userId: string) => `${TOKEN_PREFIX}${userId}.${Date.now()}`;

function login(rawBody: string | undefined): Response {
  const { email, password } = JSON.parse(rawBody ?? '{}') as { email?: string; password?: string };
  const normalized = (email ?? '').trim().toLowerCase();

  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    return json(400, {
      error: 'Validation failed',
      details: [{ path: 'email', message: 'Invalid email' }],
    });
  }
  if (!password) {
    return json(400, {
      error: 'Validation failed',
      details: [{ path: 'password', message: 'String must contain at least 1 character(s)' }],
    });
  }
  if (normalized === MOCK_LOCKED_EMAIL) {
    return json(
      423,
      {
        error: 'Account temporarily locked after too many failed attempts',
        retryAfterSeconds: MOCK_LOCKED_RETRY_SECONDS,
      },
      { 'Retry-After': String(MOCK_LOCKED_RETRY_SECONDS) },
    );
  }
  const user = MOCK_USERS.find((u) => u.email === normalized);
  if (!user || password !== MOCK_PASSWORD) {
    return json(401, { error: 'Invalid email or password' });
  }
  return json(200, { token: newToken(user.id), expiresInSeconds: 1800, user });
}

function me(authorization: string | null): Response {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  const userId = token?.startsWith(TOKEN_PREFIX) ? token.split('.')[1] : undefined;
  const user = MOCK_USERS.find((u) => u.id === userId);
  if (!user) return json(401, { error: 'Invalid or expired token' });
  return json(200, user, { 'X-Auth-Token': newToken(user.id) });
}

export const mockFetch: typeof fetch = async (input, init) => {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const { pathname } = new URL(String(input));
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers);

  if (method === 'POST' && pathname === '/auth/login') return login(init?.body as string);
  if (method === 'GET' && pathname === '/auth/me') return me(headers.get('Authorization'));
  return json(404, { error: 'Not found' });
};
