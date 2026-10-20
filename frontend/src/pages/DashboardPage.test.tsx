import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PROJECT_STATUSES } from '../api/types';
import { callsTo, jsonResponse, makeProject, makeUser, renderApp, signedInAs } from '../test/helpers';

const page = (data: unknown[], total = data.length, offset = 0) => ({ data, total, limit: 10, offset });

describe('role dashboards', () => {
  it('ADMINISTRATOR: all projects, a count per status, a status filter, and create + list navigation', async () => {
    const admin = makeUser('ADMINISTRATOR');
    const totals: Record<string, number> = { DRAFT: 4, SUBMITTED: 3, UNDER_EVALUATION: 2, EVALUATED: 1, ARCHIVED: 0 };
    const fetchMock = signedInAs(admin, {
      'GET /projects': ({ url }) => {
        const status = url.searchParams.get('status');
        if (url.searchParams.get('limit') === '1') return jsonResponse(200, page([], totals[status!]));
        if (status === 'SUBMITTED') {
          return jsonResponse(200, page([makeProject({ id: 'p-sub', title: 'Solo enviados', status: 'SUBMITTED' })]));
        }
        return jsonResponse(200, page([makeProject({ title: 'Proyecto uno' }), makeProject({ id: 'p2', title: 'Proyecto dos' })], 10));
      },
    });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Todos los proyectos' })).toBeInTheDocument();
    expect(await screen.findByText('Proyecto uno')).toBeInTheDocument();
    for (const s of PROJECT_STATUSES) {
      expect(await screen.findByTestId(`count-${s}`)).toHaveTextContent(String(totals[s]));
    }
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Proyectos' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Nuevo proyecto' })).toBeInTheDocument();

    await userEvent.setup().selectOptions(screen.getByLabelText('Filtrar por estado'), 'SUBMITTED');
    expect(await screen.findByText('Solo enviados')).toBeInTheDocument();
    expect(screen.queryByText('Proyecto uno')).not.toBeInTheDocument();
    const filtered = callsTo(fetchMock, 'GET /projects').map(([u]) => new URL(String(u)))
      .find((u) => u.searchParams.get('status') === 'SUBMITTED' && u.searchParams.get('limit') === '10');
    expect(filtered).toBeDefined();
  });

  it('RESEARCHER: own projects, marked as owned, with the New project action', async () => {
    const researcher = makeUser('RESEARCHER');
    signedInAs(researcher, {
      'GET /projects': () =>
        jsonResponse(200, page([
          makeProject({ title: 'Mío', ownerId: researcher.id }),
          makeProject({ id: 'p-collab', title: 'Colaboro aquí', ownerId: 'someone-else', status: 'SUBMITTED' }),
        ])),
    });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    await screen.findByText('Mío');
    const items = within(screen.getByRole('region', { name: 'Lista de proyectos' })).getAllByRole('listitem');
    const mine = items.find((li) => within(li).queryByText('Mío'))!;
    expect(within(mine).getByText('Dueño')).toBeInTheDocument();
    expect(within(mine).getByText('Borrador')).toBeInTheDocument(); // status as text, not just color
    const collab = items.find((li) => within(li).queryByText('Colaboro aquí'))!;
    expect(within(collab).queryByText('Dueño')).not.toBeInTheDocument();
    expect(within(collab).getByText('Enviado')).toBeInTheDocument();
    // Admin-only widgets are absent.
    expect(screen.queryByLabelText('Filtrar por estado')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Nuevo proyecto' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Nuevo proyecto' }).length).toBeGreaterThanOrEqual(2);
  });

  it('STUDENT: my projects without any create action', async () => {
    signedInAs(makeUser('STUDENT'), { 'GET /projects': () => jsonResponse(200, page([makeProject({ title: 'Colaboración' })])) });
    renderApp('/');

    expect(await screen.findByText('Colaboración')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo proyecto' })).not.toBeInTheDocument();
  });

  it('JUDGE: assigned projects, read-only, with its own empty message', async () => {
    signedInAs(makeUser('JUDGE'), { 'GET /projects': () => jsonResponse(200, page([])) });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Proyectos asignados' })).toBeInTheDocument();
    expect(await screen.findByText('Aún no hay proyectos asignados')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo proyecto' })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
  });

  it('INVESTOR: linked projects, read-only, with its own empty message', async () => {
    signedInAs(makeUser('INVESTOR'), { 'GET /projects': () => jsonResponse(200, page([])) });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Proyectos vinculados' })).toBeInTheDocument();
    expect(await screen.findByText('Aún no hay proyectos vinculados')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo proyecto' })).not.toBeInTheDocument();
  });

  it('renders exactly what the backend returned (no client-side filtering by owner)', async () => {
    // A judge's list contains projects the judge does not own: the client must not hide any of them.
    signedInAs(makeUser('JUDGE'), {
      'GET /projects': () =>
        jsonResponse(200, page([makeProject({ title: 'Ajeno A', ownerId: 'x' }), makeProject({ id: 'b', title: 'Ajeno B', ownerId: 'y' })])),
    });
    renderApp('/');
    expect(await screen.findByText('Ajeno A')).toBeInTheDocument();
    expect(screen.getByText('Ajeno B')).toBeInTheDocument();
  });

  it('shows a loading state, then an empty state for a researcher with no projects', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    signedInAs(makeUser('RESEARCHER'), {
      'GET /projects': async () => {
        await gate;
        return jsonResponse(200, page([]));
      },
    });
    renderApp('/');

    expect(await screen.findByText('Cargando proyectos...')).toBeInTheDocument();
    release();
    expect(await screen.findByText('Aún no hay proyectos')).toBeInTheDocument();
    expect(screen.queryByText('Cargando proyectos...')).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the list fails', async () => {
    let calls = 0;
    signedInAs(makeUser('RESEARCHER'), {
      'GET /projects': () =>
        ++calls === 1 ? jsonResponse(500, { error: 'Internal server error' }) : jsonResponse(200, page([makeProject({ title: 'Recuperado' })])),
    });
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Recuperado')).toBeInTheDocument();
  });

  it('paginates with limit/offset', async () => {
    const fetchMock = signedInAs(makeUser('RESEARCHER'), {
      'GET /projects': ({ url }) => {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return jsonResponse(200, page([makeProject({ id: `p${offset}`, title: offset ? 'Segunda página' : 'Primera página' })], 25, offset));
      },
    });
    renderApp('/');

    expect(await screen.findByText('Primera página')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 1–10 de 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Segunda página')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 11–20 de 25')).toBeInTheDocument();
    const last = callsTo(fetchMock, 'GET /projects').at(-1)!;
    expect(new URL(String(last[0])).searchParams.get('offset')).toBe('10');
  });
});
