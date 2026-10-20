import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Collaborator, Project, User } from '../api/types';
import {
  callsTo,
  jsonResponse,
  makeCollaborator,
  makeProject,
  makeUser,
  renderApp,
  signedInAs,
  type RouteHandler,
} from '../test/helpers';

const project0 = makeProject();
const base = `/projects/${project0.id}`;

function open(
  user: User,
  project: Project,
  collaborators: Collaborator[] = [],
  extra: Record<string, RouteHandler | Response | (() => Response)> = {},
  query = '',
) {
  const fetchMock = signedInAs(user, {
    [`GET /projects/${project.id}`]: () => jsonResponse(200, project),
    [`GET /projects/${project.id}/collaborators`]: () => jsonResponse(200, { data: collaborators }),
    [`GET /projects/${project.id}/documents`]: () => jsonResponse(200, { data: [] }),
    ...extra,
  });
  renderApp(`/projects/${project.id}${query}`);
  return fetchMock;
}

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

describe('project workspace: tabs', () => {
  it('RESEARCHER sees the five tabs with tablist semantics and moves with the arrow keys', async () => {
    const owner = makeUser('RESEARCHER');
    open(owner, makeProject({ ownerId: owner.id }), [makeCollaborator({ userId: owner.id })]);

    expect(await screen.findByRole('tablist', { name: 'Secciones del proyecto' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Vista general', 'Documentos', 'Colaboradores', 'Asistente IA', 'Progreso']);
    const [overview, documents, collaborators] = screen.getAllByRole('tab');
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(documents).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Vista general');

    const user = userEvent.setup();
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(documents).toHaveAttribute('aria-selected', 'true');
    expect(documents).toHaveFocus();
    expect(await screen.findByText('Aún no hay documentos')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Documentos');

    await user.keyboard('{ArrowRight}');
    expect(collaborators).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Progreso' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}'); // wraps around
    expect(overview).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}'); // wraps the other way
    expect(screen.getByRole('tab', { name: 'Progreso' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(overview).toHaveFocus();
  });

  it('Asistente IA and Progreso are labelled placeholders for a later week, with no fake data', async () => {
    const owner = makeUser('RESEARCHER');
    open(owner, makeProject({ ownerId: owner.id }), [makeCollaborator({ userId: owner.id })]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Asistente IA' }));
    expect(screen.getByText(/Asistente IA: disponible en una semana posterior/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Progreso' }));
    expect(screen.getByText(/Progreso: disponible en una semana posterior/)).toBeInTheDocument();
  });

  it('INVESTOR has no Documents or Collaborators tab and never requests those endpoints', async () => {
    const investor = makeUser('INVESTOR');
    const fetchMock = open(investor, makeProject({ status: 'SUBMITTED', allowedNextStatuses: [] }), [], {}, '?tab=documents');

    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(tabNames()).toEqual(['Vista general', 'Asistente IA', 'Progreso']);
    // A deep link to the hidden tab falls back to the overview.
    expect(screen.getByRole('tab', { name: 'Vista general' })).toHaveAttribute('aria-selected', 'true');
    expect(callsTo(fetchMock, `GET ${base}/documents`)).toHaveLength(0);
    expect(callsTo(fetchMock, `GET ${base}/collaborators`)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Editar|Enviar/ })).not.toBeInTheDocument();
  });

  it('JUDGE sees Documents (read-only, no upload form) but not Collaborators', async () => {
    open(makeUser('JUDGE'), makeProject({ status: 'SUBMITTED', allowedNextStatuses: [] }), [], {}, '?tab=documents');

    expect(await screen.findByText('Aún no hay documentos')).toBeInTheDocument();
    expect(tabNames()).toEqual(['Vista general', 'Documentos', 'Asistente IA', 'Progreso']);
    expect(screen.queryByRole('button', { name: 'Subir documento' })).not.toBeInTheDocument();
  });

  it('shows a clear message when the project is not visible (404)', async () => {
    signedInAs(makeUser('RESEARCHER'), {
      [`GET ${base}`]: () => jsonResponse(404, { error: 'Project not found' }),
      [`GET ${base}/collaborators`]: () => jsonResponse(404, { error: 'Project not found' }),
    });
    renderApp(base);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró el proyecto, o no tienes acceso a él.');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('project workspace: overview and status actions', () => {
  const owner = makeUser('RESEARCHER');
  const ownerRow = makeCollaborator({ userId: owner.id, fullName: owner.fullName });

  it('shows the project fields', async () => {
    open(owner, makeProject({ ownerId: owner.id, title: 'Genómica', researchArea: 'Biología', description: 'Texto largo' }), [ownerRow]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Genómica' })).toBeInTheDocument();
    expect(screen.getByText('Biología')).toBeInTheDocument();
    expect(screen.getByText('Texto largo')).toBeInTheDocument();
    expect(await screen.findByText('Dueño')).toBeInTheDocument(); // owner name comes from the collaborators list
  });

  it('offers only the actions allowed by the transition table and the caller role', async () => {
    // Owner on SUBMITTED: may withdraw, may NOT start the evaluation (administrator-only step).
    open(owner, makeProject({ ownerId: owner.id, status: 'SUBMITTED', allowedNextStatuses: ['DRAFT', 'UNDER_EVALUATION'] }), [ownerRow]);
    expect(await screen.findByRole('button', { name: 'Retirar a borrador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar evaluación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar proyecto' })).not.toBeInTheDocument(); // not DRAFT
    expect(screen.getByText('Solo se puede editar mientras el proyecto está en borrador.')).toBeInTheDocument();
  });

  it('ADMINISTRATOR is offered the evaluation steps and may edit outside DRAFT', async () => {
    open(makeUser('ADMINISTRATOR'), makeProject({ status: 'SUBMITTED', allowedNextStatuses: ['DRAFT', 'UNDER_EVALUATION'] }), []);
    expect(await screen.findByRole('button', { name: 'Iniciar evaluación' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirar a borrador' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar proyecto' })).toBeInTheDocument();
  });

  it('a MEMBER collaborator has no edit or status controls, a LEAD collaborator does', async () => {
    const student = makeUser('STUDENT');
    const draft = makeProject({ ownerId: owner.id });
    open(student, draft, [ownerRow, makeCollaborator({ userId: student.id, fullName: student.fullName, role: 'MEMBER', isOwner: false })]);
    expect(await screen.findByText('Vista de solo lectura.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar proyecto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar a revisión' })).not.toBeInTheDocument();
  });

  it('a LEAD collaborator (not the owner) can edit and submit', async () => {
    const student = makeUser('STUDENT');
    open(student, makeProject({ ownerId: owner.id }), [
      ownerRow,
      makeCollaborator({ userId: student.id, role: 'LEAD', isOwner: false }),
    ]);
    expect(await screen.findByRole('button', { name: 'Editar proyecto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeInTheDocument();
  });

  it('submits for review: sends PUT /status and shows the new state', async () => {
    const draft = makeProject({ ownerId: owner.id });
    const fetchMock = open(owner, draft, [ownerRow], {
      [`PUT ${base}/status`]: () =>
        jsonResponse(200, { ...draft, status: 'SUBMITTED', allowedNextStatuses: ['DRAFT', 'UNDER_EVALUATION'], submittedAt: '2026-10-20T10:00:00.000Z' }),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enviar a revisión' }));

    expect(await screen.findByRole('status')).toHaveTextContent('El estado del proyecto cambió a Enviado.');
    const [, init] = callsTo(fetchMock, `PUT ${base}/status`)[0];
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'SUBMITTED' });
    expect(await screen.findByRole('button', { name: 'Retirar a borrador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar a revisión' })).not.toBeInTheDocument();
  });

  it('maps 422 (incomplete) to a clear message naming the missing fields', async () => {
    open(owner, makeProject({ ownerId: owner.id, description: null }), [ownerRow], {
      [`PUT ${base}/status`]: () =>
        jsonResponse(422, { error: 'Project is incomplete; required before submitting: title, description', missing: ['title', 'description'] }),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enviar a revisión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan título y descripción para enviar el proyecto.');
    // Still in DRAFT: the action remains available to retry after completing the fields.
    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeEnabled();
  });

  it('maps 409 (invalid transition) using from/to/allowed from the response', async () => {
    open(owner, makeProject({ ownerId: owner.id }), [ownerRow], {
      [`PUT ${base}/status`]: () =>
        jsonResponse(409, { error: 'Invalid status transition', from: 'SUBMITTED', to: 'SUBMITTED', allowed: ['DRAFT', 'UNDER_EVALUATION'] }),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enviar a revisión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se puede pasar de Enviado a Enviado. Desde Enviado solo se permite: Borrador, En evaluación.',
    );
  });

  it('maps 403 and 404 on a status change', async () => {
    const draft = makeProject({ ownerId: owner.id });
    let status = 403;
    open(owner, draft, [ownerRow], {
      [`PUT ${base}/status`]: () => jsonResponse(status, { error: 'x' }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Enviar a revisión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para cambiar el estado de este proyecto.');

    status = 404;
    await user.click(screen.getByRole('button', { name: 'Enviar a revisión' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('El proyecto ya no existe o no tienes acceso a él.'));
  });

  it('edits a DRAFT: PUT sends all fields (emptied optional ones as null) and shows the result', async () => {
    const draft = makeProject({ ownerId: owner.id, title: 'Antes', summary: 'Resumen viejo' });
    const fetchMock = open(owner, draft, [ownerRow], {
      [`PUT ${base}`]: ({ init }) => jsonResponse(200, { ...draft, ...JSON.parse(String(init?.body)) }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Editar proyecto' }));
    const title = screen.getByLabelText('Título');
    await user.clear(title);
    await user.type(title, 'Después');
    await user.clear(screen.getByLabelText('Resumen'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Después' })).toBeInTheDocument();
    const [, init] = callsTo(fetchMock, `PUT ${base}`)[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ title: 'Después', summary: null });
    expect(screen.getByRole('status')).toHaveTextContent('Los cambios se guardaron.');
  });

  it('shows the 409 of an edit outside DRAFT and 400 field details', async () => {
    const draft = makeProject({ ownerId: owner.id });
    let respond: () => Response = () => jsonResponse(409, { error: 'Project is SUBMITTED; only DRAFT projects can be edited' });
    open(owner, draft, [ownerRow], { [`PUT ${base}`]: () => respond() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Editar proyecto' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El proyecto ya no está en borrador');

    respond = () => jsonResponse(400, { error: 'Validation failed', details: [{ path: 'affiliation', message: 'String must contain at most 200 character(s)' }] });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Máximo 200 caracteres.')).toBeInTheDocument();
  });
});

describe('project workspace: collaborators', () => {
  const owner = makeUser('RESEARCHER');
  const ownerRow = makeCollaborator({ userId: owner.id, fullName: owner.fullName });
  const other = '33333333-3333-4333-8333-333333333333';
  const otherRow = makeCollaborator({ userId: other, fullName: 'Sam Student', email: 'sam@example.edu', userRole: 'STUDENT', role: 'MEMBER', isOwner: false });
  const draft = makeProject({ ownerId: owner.id });

  it('lists collaborators with role and owner marker', async () => {
    open(owner, draft, [ownerRow, otherRow], {}, '?tab=collaborators');

    const list = await screen.findByRole('region', { name: 'Colaboradores del proyecto' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Dueño')).toBeInTheDocument();
    expect(within(items[0]).getByText('Líder')).toBeInTheDocument();
    expect(within(items[0]).queryByRole('button')).not.toBeInTheDocument(); // the owner cannot be removed
    expect(within(items[1]).getByText('Sam Student')).toBeInTheDocument();
    expect(within(items[1]).getByText('Miembro')).toBeInTheDocument();
    expect(within(items[1]).getByText(/sam@example.edu/)).toBeInTheDocument();
  });

  it('adds a collaborator by userId (validating the UUID first) and refreshes the list', async () => {
    const fetchMock = open(owner, draft, [ownerRow], {
      [`POST ${base}/collaborators`]: () => jsonResponse(201, { data: [ownerRow, otherRow] }),
    }, '?tab=collaborators');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Identificador del usuario (UUID)'), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: 'Agregar colaborador' }));
    expect(screen.getByText('Ingresa un identificador de usuario válido (UUID).')).toBeInTheDocument();
    expect(callsTo(fetchMock, `POST ${base}/collaborators`)).toHaveLength(0);

    const input = screen.getByLabelText('Identificador del usuario (UUID)');
    await user.clear(input);
    await user.type(input, other);
    await user.selectOptions(screen.getByLabelText('Rol en el proyecto'), 'LEAD');
    await user.click(screen.getByRole('button', { name: 'Agregar colaborador' }));

    expect(await screen.findByText('Sam Student')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Colaborador agregado.');
    const [, init] = callsTo(fetchMock, `POST ${base}/collaborators`)[0];
    expect(JSON.parse(String(init?.body))).toEqual({ userId: other, role: 'LEAD' });
  });

  it.each([
    [404, 'No existe un usuario activo con ese identificador.'],
    [409, 'Ese usuario ya es colaborador del proyecto'],
    [422, 'Solo usuarios con rol Investigador o Estudiante pueden ser colaboradores.'],
    [403, 'No tienes permiso para agregar colaboradores a este proyecto.'],
  ])('maps the %s of adding a collaborator', async (status, message) => {
    open(owner, draft, [ownerRow], { [`POST ${base}/collaborators`]: () => jsonResponse(status, { error: 'x' }) }, '?tab=collaborators');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Identificador del usuario (UUID)'), other);
    await user.click(screen.getByRole('button', { name: 'Agregar colaborador' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('removes a collaborator after an explicit confirmation', async () => {
    const fetchMock = open(owner, draft, [ownerRow, otherRow], {
      [`DELETE ${base}/collaborators/${other}`]: () => new Response(null, { status: 204 }),
    }, '?tab=collaborators');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Quitar a Sam Student' }));
    expect(callsTo(fetchMock, `DELETE ${base}/collaborators/${other}`)).toHaveLength(0); // not yet
    await user.click(screen.getByRole('button', { name: 'Confirmar quitar a Sam Student' }));

    await waitFor(() => expect(screen.queryByText('Sam Student')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Sam Student ya no es colaborador.');
    expect(callsTo(fetchMock, `DELETE ${base}/collaborators/${other}`)).toHaveLength(1);
  });

  it('cancelling the confirmation keeps the collaborator and sends nothing', async () => {
    const fetchMock = open(owner, draft, [ownerRow, otherRow], {}, '?tab=collaborators');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Quitar a Sam Student' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Sam Student')).toBeInTheDocument();
    expect(callsTo(fetchMock, `DELETE ${base}/collaborators/${other}`)).toHaveLength(0);
  });

  it('a MEMBER can read the list but sees no add form and no remove buttons', async () => {
    const student = makeUser('STUDENT', { id: other });
    open(student, draft, [ownerRow, otherRow], {}, '?tab=collaborators');

    expect(await screen.findByText('Sam Student')).toBeInTheDocument();
    expect(screen.queryByLabelText('Identificador del usuario (UUID)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument();
  });

  it('surfaces the 409 when removing fails (e.g. the owner)', async () => {
    open(owner, draft, [ownerRow, otherRow], {
      [`DELETE ${base}/collaborators/${other}`]: () => jsonResponse(409, { error: 'The project owner cannot be removed' }),
    }, '?tab=collaborators');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Quitar a Sam Student' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar quitar a Sam Student' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El dueño del proyecto no se puede quitar.');
  });
});
