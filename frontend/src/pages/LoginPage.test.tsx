import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { tokenStore } from '../auth/tokenStore';
import { jsonResponse, renderApp, stubApi, stubFetch, TEST_USER } from '../test/helpers';

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('Correo electrónico'), email);
  if (password) await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('LoginPage', () => {
  it('renders the form with labelled fields', () => {
    renderApp('/login');
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  it('validates empty and malformed input without calling the API', async () => {
    const fetchMock = stubFetch();
    renderApp('/login');

    await submit('', '');
    expect(screen.getByText('Ingresa un correo electrónico válido.')).toBeInTheDocument();
    expect(screen.getByText('Ingresa tu contraseña.')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.setup().type(screen.getByLabelText('Correo electrónico'), 'not-an-email');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(screen.getByText('Ingresa un correo electrónico válido.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the session and navigates to the dashboard on success', async () => {
    const fetchMock = stubApi({
      'POST /auth/login': () => jsonResponse(200, { token: 'jwt-1', expiresInSeconds: 1800, user: TEST_USER }),
      'GET /projects': () =>
        jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }, { 'X-Auth-Token': 'jwt-2' }),
    });
    renderApp('/login');

    await submit('rita@example.edu', 'correct horse battery');

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/login$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'rita@example.edu',
      password: 'correct horse battery',
    });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);

    // The dashboard calls GET /projects with the stored token, and the refreshed one replaces it.
    await waitFor(() => expect(tokenStore.get()).toBe('jwt-2'));
    const projectsCall = fetchMock.mock.calls.find(([u]) => /\/projects/.test(String(u)))!;
    expect(new Headers(projectsCall[1]?.headers).get('Authorization')).toBe('Bearer jwt-1');
  });

  it('shows one generic message on 401 and keeps the user on the form', async () => {
    stubFetch(jsonResponse(401, { error: 'Invalid email or password' }));
    renderApp('/login');

    await submit('nobody@example.edu', 'wrong-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Correo electrónico o contraseña incorrectos.');
    expect(tokenStore.get()).toBeNull();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  it('tells the user how many minutes remain when the account is locked (423)', async () => {
    stubFetch(
      jsonResponse(
        423,
        { error: 'Account temporarily locked after too many failed attempts', retryAfterSeconds: 541 },
        { 'Retry-After': '541' },
      ),
    );
    renderApp('/login');

    await submit('locked@example.edu', 'whatever');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'la cuenta está bloqueada temporalmente. Inténtalo de nuevo en 10 minutos.',
    );
  });

  it('uses the singular for one remaining minute', async () => {
    stubFetch(jsonResponse(423, { error: 'locked', retryAfterSeconds: 30 }));
    renderApp('/login');

    await submit('locked@example.edu', 'whatever');

    expect(await screen.findByRole('alert')).toHaveTextContent('Inténtalo de nuevo en 1 minuto.');
  });

  it('shows a rate limit message on 429', async () => {
    stubFetch(jsonResponse(429, { error: 'Too many requests, please try again later' }));
    renderApp('/login');

    await submit('rita@example.edu', 'whatever');

    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiadas solicitudes.');
  });

  it('maps server-side 400 validation details onto fields', async () => {
    stubFetch(
      jsonResponse(400, {
        error: 'Validation failed',
        details: [{ path: 'email', message: 'Invalid email' }],
      }),
    );
    renderApp('/login');

    await submit('rita@example.edu', 'whatever');

    expect(await screen.findByText('Ingresa un correo electrónico válido.')).toBeInTheDocument();
  });

  it('reports an unreachable server', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    renderApp('/login');

    await submit('rita@example.edu', 'whatever');

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
  });
});
