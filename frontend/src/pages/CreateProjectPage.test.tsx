import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, jsonResponse, makeCollaborator, makeProject, makeUser, renderApp, signedInAs } from '../test/helpers';

describe('create project', () => {
  it('validates the title client-side and sends nothing', async () => {
    const fetchMock = signedInAs(makeUser('RESEARCHER'));
    renderApp('/projects/new');

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Crear proyecto' }));

    expect(screen.getByText('El título es obligatorio.')).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(fetchMock, 'POST /projects')).toHaveLength(0);
  });

  it('maps the 400 details of the server onto the fields', async () => {
    signedInAs(makeUser('RESEARCHER'), {
      'POST /projects': () =>
        jsonResponse(400, {
          error: 'Validation failed',
          details: [
            { path: 'title', message: 'String must contain at most 300 character(s)' },
            { path: 'researchArea', message: 'Unrecognized key' },
          ],
        }),
    });
    renderApp('/projects/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Título'), 'Mi proyecto');
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(await screen.findByText('Máximo 300 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('Unrecognized key')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa los campos marcados.');
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true');
    // The form stays usable for a correction.
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeEnabled();
  });

  it('creates the project (omitting empty optional fields) and opens its workspace', async () => {
    const researcher = makeUser('RESEARCHER');
    const created = makeProject({ title: 'Mi proyecto', ownerId: researcher.id });
    const fetchMock = signedInAs(researcher, {
      'POST /projects': () => jsonResponse(201, created),
      [`GET /projects/${created.id}`]: () => jsonResponse(200, created),
      [`GET /projects/${created.id}/collaborators`]: () => jsonResponse(200, { data: [makeCollaborator({ userId: researcher.id })] }),
    });
    renderApp('/projects/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Título'), '  Mi proyecto  ');
    await user.type(screen.getByLabelText('Área de investigación'), 'Química');
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(await screen.findByRole('heading', { name: 'Mi proyecto' })).toBeInTheDocument();
    const [, init] = callsTo(fetchMock, 'POST /projects')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Mi proyecto', researchArea: 'Química' });
  });

  it('reports a 403 from the server in plain language', async () => {
    signedInAs(makeUser('ADMINISTRATOR'), { 'POST /projects': () => jsonResponse(403, { error: 'Forbidden' }) });
    renderApp('/projects/new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Título'), 'X');
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no puede crear proyectos.');
  });

  it('sends roles that cannot create projects back to the dashboard', async () => {
    signedInAs(makeUser('STUDENT'), { 'GET /projects': () => jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }) });
    renderApp('/projects/new');

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear proyecto' })).not.toBeInTheDocument();
  });
});
