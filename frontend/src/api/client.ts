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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** A FormData is sent as multipart (the browser sets the boundary); anything else as JSON. */
  body?: unknown;
  /** false for endpoints that must not send the token or treat a 401 as an expired session (login). */
  authenticated?: boolean;
  accept?: string;
}

async function readBody(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody;
  } catch {
    return {};
  }
}

/**
 * Single code path for every request (JSON, multipart upload, blob download): attaches the bearer
 * token, applies the sliding-session X-Auth-Token replacement, handles 401, and throws ApiError for
 * any non-2xx response. Callers decide how to read the successful body.
 */
async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, authenticated = true, accept = 'application/json' } = options;
  const headers: Record<string, string> = { Accept: accept };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = authenticated ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    const doFetch = await getFetch();
    res = await doFetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'Unable to reach the server' });
  }

  // Sliding session: the server issues a fresh token on every authenticated response.
  const refreshed = res.headers.get('X-Auth-Token');
  if (refreshed) tokenStore.replaceIfPresent(refreshed);

  if (res.ok) return res;

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

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Authenticated binary download (a bare <a href> cannot send the bearer token). */
export async function apiDownload(path: string): Promise<Blob> {
  const res = await send(path, { accept: '*/*' });
  return res.blob();
}
