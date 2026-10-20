import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi, stubFetch, TEST_USER } from '../test/helpers';
import { tokenStore } from './tokenStore';

describe('protected routes and session', () => {
  it('redirects an anonymous visitor from the dashboard to /login', () => {
    const fetchMock = stubFetch();
    renderApp('/');
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restores a stored session through GET /auth/me', async () => {
    tokenStore.set('jwt-old');
    const fetchMock = stubApi({
      'GET /auth/me': () => jsonResponse(200, TEST_USER, { 'X-Auth-Token': 'jwt-new' }),
      'GET /projects': () => jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }, { 'X-Auth-Token': 'jwt-newer' }),
    });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer jwt-old');
    await waitFor(() => expect(tokenStore.get()).toBe('jwt-newer'));
  });

  it('clears the session and shows a notice when the token is rejected (401)', async () => {
    tokenStore.set('jwt-expired');
    stubFetch(jsonResponse(401, { error: 'Invalid or expired token' }));
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Tu sesión expiró');
    expect(tokenStore.get()).toBeNull();
  });

  it('logs out: clears the token and returns to /login', async () => {
    tokenStore.set('jwt-1');
    stubApi({
      'GET /auth/me': () => jsonResponse(200, TEST_USER),
      'GET /projects': () => jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }),
    });
    renderApp('/');

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
    expect(screen.queryByText(/sesión expiró/i)).not.toBeInTheDocument();
  });
});
