import { describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../auth/tokenStore';
import { jsonResponse, stubFetch } from '../test/helpers';
import { ApiError, apiRequest, setUnauthorizedHandler } from './client';

describe('apiRequest', () => {
  it('sends the bearer token and replaces it with X-Auth-Token from every response', async () => {
    tokenStore.set('jwt-1');
    const fetchMock = stubFetch(
      jsonResponse(200, { ok: 1 }, { 'X-Auth-Token': 'jwt-2' }),
      jsonResponse(200, { ok: 2 }, { 'X-Auth-Token': 'jwt-3' }),
    );

    await apiRequest('/auth/me');
    expect(tokenStore.get()).toBe('jwt-2');
    await apiRequest('/auth/me');
    expect(tokenStore.get()).toBe('jwt-3');

    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer jwt-1');
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer jwt-2');
  });

  it('does not resurrect a session that was cleared before the response arrived', async () => {
    stubFetch(jsonResponse(200, {}, { 'X-Auth-Token': 'late-token' }));
    await apiRequest('/auth/me');
    expect(tokenStore.get()).toBeNull();
  });

  it('clears the session and notifies the handler on 401', async () => {
    tokenStore.set('jwt-1');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubFetch(jsonResponse(401, { error: 'Invalid or expired token' }));

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(tokenStore.get()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
    setUnauthorizedHandler(null);
  });

  it('treats a 401 from an unauthenticated call (login) as a plain error, not an expired session', async () => {
    tokenStore.set('jwt-1');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubFetch(jsonResponse(401, { error: 'Invalid email or password' }));

    await expect(apiRequest('/auth/login', { authenticated: false, method: 'POST', body: {} })).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(tokenStore.get()).toBe('jwt-1');
    expect(handler).not.toHaveBeenCalled();
    setUnauthorizedHandler(null);
  });

  it('exposes retryAfterSeconds from the Retry-After header when the body has none', async () => {
    stubFetch(jsonResponse(429, { error: 'Too many requests' }, { 'Retry-After': '120' }));
    await expect(apiRequest('/auth/login', { authenticated: false })).rejects.toMatchObject({
      status: 429,
      body: { retryAfterSeconds: 120 },
    });
  });
});
