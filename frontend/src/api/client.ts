import { tokenStore } from '../auth/tokenStore';
import { API_URL } from './config';
import type { ErrorBody } from './types';

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the server could not be reached. */
    public readonly status: number,
    public readonly body: ErrorBody,
  ) {
    super(body.error ?? `Request failed (${status})`);
  }
}

let onUnauthorized: (() => void) | null = null;

/** Registered by the auth provider; called after the stored session was cleared on a 401. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function getFetch(): Promise<typeof fetch> {
  // Must stay a literal import.meta.env check: Vite inlines it at build time, so the mock
  // module is dropped from production bundles when VITE_USE_MOCKS is not 'true'.
  if (import.meta.env.VITE_USE_MOCKS === 'true') return (await import('../mocks/mockFetch')).mockFetch;
  return fetch;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** false for endpoints that must not send the token or treat a 401 as an expired session (login). */
  authenticated?: boolean;
}

async function readBody(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody;
  } catch {
    return {};
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = authenticated ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    const doFetch = await getFetch();
    res = await doFetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'Unable to reach the server' });
  }

  // Sliding session: the server issues a fresh token on every authenticated response.
  const refreshed = res.headers.get('X-Auth-Token');
  if (refreshed) tokenStore.replaceIfPresent(refreshed);

  if (res.ok) return (await res.json()) as T;

  const errorBody = await readBody(res);
  if (!errorBody.retryAfterSeconds) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) errorBody.retryAfterSeconds = retryAfter;
  }
  if (res.status === 401 && authenticated) {
    tokenStore.clear();
    onUnauthorized?.();
  }
  throw new ApiError(res.status, errorBody);
}
