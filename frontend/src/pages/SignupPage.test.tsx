import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { tokenStore } from '../auth/tokenStore';
import { callsTo, jsonResponse, makeUser, renderApp, stubApi } from '../test/helpers';

const created = makeUser('USER', { fullName: 'Nora Nueva', email: 'nora@unipolidgo.edu.mx' });

async function fill(user: ReturnType<typeof userEvent.setup>, over: Partial<Record<'name' | 'email' | 'pw' | 'confirm', string>> = {}) {
  await user.type(await screen.findByLabelText('Nombre completo'), over.name ?? 'Nora Nueva');
  await user.type(screen.getByLabelText('Correo electrónico'), over.email ?? 'nora@unipolidgo.edu.mx');
  await user.type(screen.getByLabelText('Contraseña'), over.pw ?? 'una-clave-larga-1');
  await user.type(screen.getByLabelText('Confirmar contraseña'), over.confirm ?? 'una-clave-larga-1');
}

describe('signup', () => {
  it('is reachable from the login page', async () => {
    stubApi({});
    renderApp('/login');
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('heading', { name: 'Crear cuenta' })).toBeInTheDocument();
  });

  it('validates locally, never sends a role, signs the new USER in and lands on their dashboard', async () => {
    const fetchMock = stubApi({
      'POST /auth/register': () => jsonResponse(201, { token: 'jwt-new', expiresInSeconds: 1800, user: created }),
      'GET /projects': () => jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }),
      'GET /notifications': () => jsonResponse(200, { data: [], total: 0, unread: 0, limit: 1, offset: 0 }),
    });
    renderApp('/signup');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText('Ingresa tu nombre completo.')).toBeInTheDocument();
    expect(screen.getByText('Ingresa un correo electrónico válido.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /auth/register')).toHaveLength(0);

    await fill(user, { name: 'Nora Nueva', email: 'nora@unipolidgo.edu.mx', pw: 'corta', confirm: 'corta' });
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Usa al menos 10 caracteres.')).toBeInTheDocument();
  });

  it('creates the account with only the allowed fields', async () => {
    const fetchMock = stubApi({
      'POST /auth/register': () => jsonResponse(201, { token: 'jwt-new', expiresInSeconds: 1800, user: created }),
      'GET /projects': () => jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }),
      'GET /notifications': () => jsonResponse(200, { data: [], total: 0, unread: 0, limit: 1, offset: 0 }),
    });
    renderApp('/signup');
    const user = userEvent.setup();
    await fill(user);
    await user.type(screen.getByLabelText(/Institución o área/), 'UNIPOLI');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    const body = JSON.parse(String(callsTo(fetchMock, 'POST /auth/register')[0][1]?.body));
    expect(body).toEqual({ fullName: 'Nora Nueva', email: 'nora@unipolidgo.edu.mx', password: 'una-clave-larga-1', affiliation: 'UNIPOLI' });
    expect(body).not.toHaveProperty('role');
    expect(body).not.toHaveProperty('confirm');
    await waitFor(() => expect(tokenStore.get()).toBe('jwt-new'));
  });

  it('mismatched passwords are caught before sending', async () => {
    const fetchMock = stubApi({});
    renderApp('/signup');
    const user = userEvent.setup();
    await fill(user, { confirm: 'otra-clave-larga-2' });
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /auth/register')).toHaveLength(0);
  });

  it.each([
    [409, { error: 'dup' }, 'Ya existe una cuenta con ese correo electrónico. Inicia sesión.'],
    [422, { error: 'domain', code: 'EMAIL_DOMAIN_NOT_ALLOWED', domain: 'unipolidgo.edu.mx' }, 'El registro está limitado a correos @unipolidgo.edu.mx.'],
  ])('shows the backend %s answer', async (status, body, message) => {
    stubApi({ 'POST /auth/register': () => jsonResponse(status, body) });
    renderApp('/signup');
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('tells reviewers that an administrator creates their account', async () => {
    stubApi({});
    renderApp('/signup');
    expect(await screen.findByText(/Tu cuenta la crea un administrador/)).toBeInTheDocument();
  });
});
