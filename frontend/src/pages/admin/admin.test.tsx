import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Criterion, JudgeAssignment } from '../../api/types';
import { callsTo, jsonResponse, makeProject, makeUser, renderApp, signedInAs } from '../../test/helpers';

const page = (data: unknown[], total = data.length) => ({ data, total, limit: 10, offset: 0 });
const admin = makeUser('ADMINISTRATOR');

const criterion = (over: Partial<Criterion> = {}): Criterion => ({
  id: 'c1',
  name: 'Viabilidad técnica',
  description: null,
  maxScore: 10,
  weight: 1,
  position: 0,
  isActive: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

describe('admin routes', () => {
  it('a non-admin who opens /admin/users is sent back to the dashboard', async () => {
    signedInAs(makeUser('RESEARCHER'), { 'GET /projects': () => jsonResponse(200, page([])) });
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
  });

  it('the administrator navigation links to users, criteria and assignments', async () => {
    signedInAs(admin, { 'GET /projects': () => jsonResponse(200, page([])) });
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    for (const name of ['Usuarios', 'Criterios', 'Asignación de jueces']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
  });
});

describe('admin users', () => {
  it('lists users, searches, and creates one (duplicate email shows the backend conflict)', async () => {
    const existing = makeUser('STUDENT', { fullName: 'Sara Student' });
    let createStatus = 409;
    const fetchMock = signedInAs(admin, {
      'GET /users': () => jsonResponse(200, page([existing])),
      'POST /users': () =>
        createStatus === 409
          ? jsonResponse(409, { error: 'Email already registered' })
          : jsonResponse(201, makeUser('JUDGE', { fullName: 'Juan Juez' })),
    });
    renderApp('/admin/users');
    expect(await screen.findByText('Sara Student')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar por nombre o correo'), 'sara');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(callsTo(fetchMock, 'GET /users').length).toBeGreaterThan(1));
    const last = callsTo(fetchMock, 'GET /users').at(-1)!;
    expect(new URL(String(last[0])).searchParams.get('q')).toBe('sara');

    await user.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    const form = screen.getByRole('form', { name: 'Nuevo usuario' });
    await user.click(within(form).getByRole('button', { name: 'Crear usuario' }));
    expect(within(form).getByText('Ingresa el nombre completo.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /users')).toHaveLength(0);

    await user.type(within(form).getByLabelText('Nombre completo'), 'Juan Juez');
    await user.type(within(form).getByLabelText('Correo electrónico'), 'juan@example.edu');
    await user.type(within(form).getByLabelText('Contraseña inicial'), 'una-clave-larga-1');
    await user.selectOptions(within(form).getByLabelText('Rol'), 'JUDGE');
    await user.click(within(form).getByRole('button', { name: 'Crear usuario' }));
    expect(await screen.findByText('Ya existe una cuenta con ese correo electrónico.')).toBeInTheDocument();

    createStatus = 201;
    await user.click(within(form).getByRole('button', { name: 'Crear usuario' }));
    expect(await screen.findByText('Usuario Juan Juez creado.')).toBeInTheDocument();
    const body = JSON.parse(String(callsTo(fetchMock, 'POST /users').at(-1)![1]!.body));
    expect(body).toMatchObject({ email: 'juan@example.edu', role: 'JUDGE', fullName: 'Juan Juez' });
  });

  it('edits a user: sends only the changed contract fields, never the email', async () => {
    const existing = makeUser('STUDENT', { id: '00000000-0000-4000-8000-0000000000aa', fullName: 'Sara Student' });
    const fetchMock = signedInAs(admin, {
      'GET /users': () => jsonResponse(200, page([existing])),
      [`PUT /users/${existing.id}`]: () => jsonResponse(200, { ...existing, isActive: false }),
    });
    renderApp('/admin/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar a Sara Student' }));
    const form = screen.getByRole('form', { name: 'Editar usuario' });
    expect(within(form).getByLabelText('Correo electrónico')).toBeDisabled();
    await user.click(within(form).getByLabelText('Cuenta activa'));
    await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios de Sara Student guardados.')).toBeInTheDocument();
    const body = JSON.parse(String(callsTo(fetchMock, `PUT /users/${existing.id}`)[0][1]!.body));
    expect(body.isActive).toBe(false);
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('password');
  });
});

describe('admin criteria', () => {
  it('validates, creates and deactivates criteria', async () => {
    let list = [criterion()];
    const fetchMock = signedInAs(admin, {
      'GET /criteria': () => jsonResponse(200, { data: list }),
      'POST /criteria': ({ init }) => {
        const created = criterion({ id: 'c2', ...JSON.parse(String(init!.body)) });
        list = [...list, created];
        return jsonResponse(201, created);
      },
      'PUT /criteria/c1': ({ init }) => {
        list = [criterion({ ...JSON.parse(String(init!.body)) })];
        return jsonResponse(200, list[0]);
      },
    });
    renderApp('/admin/criteria');
    expect(await screen.findByText('Viabilidad técnica')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET /criteria')[0][0]).toContain('includeInactive=true');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Nuevo criterio' }));
    const form = screen.getByRole('form', { name: 'Nuevo criterio' });
    await user.click(within(form).getByRole('button', { name: 'Crear criterio' }));
    expect(within(form).getByText('Ingresa el nombre del criterio.')).toBeInTheDocument();

    await user.type(within(form).getByLabelText('Nombre'), 'Innovación');
    await user.clear(within(form).getByLabelText('Peso'));
    await user.type(within(form).getByLabelText('Peso'), '1.234');
    await user.click(within(form).getByRole('button', { name: 'Crear criterio' }));
    expect(within(form).getByText('Entre 0.01 y 99.99, con máximo 2 decimales.')).toBeInTheDocument();

    await user.clear(within(form).getByLabelText('Peso'));
    await user.type(within(form).getByLabelText('Peso'), '2.5');
    await user.click(within(form).getByRole('button', { name: 'Crear criterio' }));
    expect(await screen.findByText('Criterio «Innovación» creado.')).toBeInTheDocument();
    const body = JSON.parse(String(callsTo(fetchMock, 'POST /criteria')[0][1]!.body));
    expect(body).toMatchObject({ name: 'Innovación', weight: 2.5, maxScore: 10 });

    await user.click(screen.getByRole('button', { name: 'Desactivar criterio Viabilidad técnica' }));
    expect(await screen.findByText('Criterio «Viabilidad técnica» desactivado.')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, 'PUT /criteria/c1')[0][1]!.body))).toEqual({ isActive: false });
  });
});

describe('admin judge assignments', () => {
  const project = makeProject({ id: 'p-sub', title: 'Proyecto enviado', status: 'SUBMITTED' });
  const judge = makeUser('JUDGE', { fullName: 'Julia Juez', affiliation: 'Otra Universidad' });
  const assignment: JudgeAssignment = {
    id: 'a1',
    projectId: project.id,
    judgeId: judge.id,
    assignedById: admin.id,
    status: 'ASSIGNED',
    assignedAt: '2026-10-20T10:00:00.000Z',
    completedAt: null,
    judge: { id: judge.id, fullName: judge.fullName, email: judge.email, affiliation: judge.affiliation },
    project: { id: project.id, title: project.title, status: 'SUBMITTED' },
  };

  function routes(post: () => Response) {
    return {
      'GET /judge-assignments': () => jsonResponse(200, page([])),
      'GET /projects': ({ url }: { url: URL }) =>
        jsonResponse(200, page(url.searchParams.get('status') === 'SUBMITTED' ? [project] : [])),
      'GET /users': () => jsonResponse(200, page([judge, makeUser('JUDGE', { id: 'x', fullName: 'Inactivo', isActive: false })])),
      'POST /judge-assignments': post,
    };
  }

  it('assigns a judge and only offers active judges and assignable projects', async () => {
    const fetchMock = signedInAs(admin, routes(() => jsonResponse(201, assignment)));
    renderApp('/admin/assignments');
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Proyecto enviado' });
    expect(screen.queryByRole('option', { name: /Inactivo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Asignar juez' }));
    expect(screen.getByText('Elige un proyecto y un juez.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Proyecto'), project.id);
    await user.selectOptions(screen.getByLabelText('Juez'), judge.id);
    await user.click(screen.getByRole('button', { name: 'Asignar juez' }));
    expect(await screen.findByText('Julia Juez fue asignado a «Proyecto enviado».')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, 'POST /judge-assignments')[0][1]!.body))).toEqual({
      projectId: project.id,
      judgeId: judge.id,
    });
  });

  it('shows the conflict-of-interest reasons the backend returns (422)', async () => {
    signedInAs(
      admin,
      routes(() =>
        jsonResponse(422, {
          error: 'Conflict of interest',
          code: 'CONFLICT_OF_INTEREST',
          reasons: [{ code: 'SAME_AFFILIATION', message: 'El juez comparte afiliación con el proyecto.' }],
        }),
      ),
    );
    renderApp('/admin/assignments');
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Proyecto enviado' });
    await user.selectOptions(screen.getByLabelText('Proyecto'), project.id);
    await user.selectOptions(screen.getByLabelText('Juez'), judge.id);
    await user.click(screen.getByRole('button', { name: 'Asignar juez' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El juez comparte afiliación con el proyecto.');
  });
});
