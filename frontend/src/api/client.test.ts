import { describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../auth/tokenStore';
import { jsonResponse, stubFetch } from '../test/helpers';
import { ApiError, apiDownload, apiRequest, setUnauthorizedHandler } from './client';

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

  it('sends FormData as-is (no JSON Content-Type, so the browser sets the multipart boundary)', async () => {
    tokenStore.set('jwt-1');
    const fetchMock = stubFetch(jsonResponse(201, { id: 'x' }, { 'X-Auth-Token': 'jwt-2' }));
    const form = new FormData();
    form.append('type', 'REPORT');

    await apiRequest('/projects/p/documents', { method: 'POST', body: form });

    const init = fetchMock.mock.calls[0][1];
    expect(init?.body).toBe(form);
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    expect(tokenStore.get()).toBe('jwt-2');
  });

  it('returns undefined for 204 responses and supports DELETE', async () => {
    tokenStore.set('jwt-1');
    const fetchMock = stubFetch(new Response(null, { status: 204, headers: { 'X-Auth-Token': 'jwt-2' } }));
    await expect(apiRequest('/projects/p/collaborators/u', { method: 'DELETE' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
    expect(tokenStore.get()).toBe('jwt-2');
  });

  it('apiDownload returns the Blob with the bearer token, applies the sliding token and throws ApiError on failure', async () => {
    tokenStore.set('jwt-1');
    const fetchMock = stubFetch(
      new Response('bytes', { status: 200, headers: { 'X-Auth-Token': 'jwt-2' } }),
      jsonResponse(404, { error: 'Document not found' }),
    );

    const blob = await apiDownload('/projects/p/documents/d/download');
    expect(await blob.text()).toBe('bytes');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer jwt-1');
    expect(tokenStore.get()).toBe('jwt-2');

    await expect(apiDownload('/projects/p/documents/d/download')).rejects.toMatchObject({ status: 404 });
  });

  it('a 401 on a download also clears the session', async () => {
    tokenStore.set('jwt-1');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubFetch(jsonResponse(401, { error: 'Invalid or expired token' }));
    await expect(apiDownload('/x')).rejects.toBeInstanceOf(ApiError);
    expect(tokenStore.get()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
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
