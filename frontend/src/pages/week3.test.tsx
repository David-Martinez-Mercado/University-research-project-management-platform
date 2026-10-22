import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MyEvaluation } from '../api/types';
import { callsTo, jsonResponse, makeProject, makeUser, renderApp, signedInAs } from '../test/helpers';

const project = makeProject({ status: 'UNDER_EVALUATION', allowedNextStatuses: [] });
const base = `/projects/${project.id}`;

const evaluation = (over: Partial<MyEvaluation> = {}): MyEvaluation => ({
  projectId: project.id,
  project: { id: project.id, title: project.title, status: 'UNDER_EVALUATION' },
  assignment: { id: 'a1', status: 'ASSIGNED', completedAt: null },
  state: 'NOT_STARTED',
  canEdit: true,
  criteria: [
    { criterionId: 'c1', name: 'Viabilidad', description: null, maxScore: 10, weight: 2, score: null, comments: null },
    { criterionId: 'c2', name: 'Innovación', description: null, maxScore: 10, weight: 1, score: null, comments: null },
  ],
  ...over,
});

function openAs(role: Parameters<typeof makeUser>[0], tab: string, routes: Parameters<typeof signedInAs>[1]) {
  return signedInAs(makeUser(role), {
    [`GET ${base}`]: () => jsonResponse(200, project),
    [`GET ${base}/documents`]: () => jsonResponse(200, { data: [] }),
    ...routes,
  }) && renderApp(`${base}?tab=${tab}`);
}

describe('judge evaluation tab', () => {
  it('recovers a saved draft, validates, saves a draft and submits after confirmation', async () => {
    let state = evaluation({
      state: 'DRAFT',
      criteria: evaluation().criteria.map((c) => (c.criterionId === 'c1' ? { ...c, score: 7, comments: 'Buen avance' } : c)),
    });
    const fetchMock = signedInAs(makeUser('JUDGE'), {
      [`GET ${base}`]: () => jsonResponse(200, project),
      [`GET ${base}/evaluation`]: () => jsonResponse(200, state),
      'POST /evaluations': ({ init }) => {
        const body = JSON.parse(String(init!.body));
        state = body.submit
          ? evaluation({ state: 'SUBMITTED', canEdit: false })
          : {
              ...state,
              criteria: state.criteria.map((c) => {
                const sent = body.scores.find((s: { criterionId: string }) => s.criterionId === c.criterionId);
                return sent ? { ...c, score: sent.score, comments: sent.comments } : c;
              }),
            };
        return jsonResponse(body.submit ? 201 : 200, { ...state, projectClosed: false });
      },
    });
    renderApp(`${base}?tab=evaluation`);

    // FR-029: the draft is rebuilt from the server.
    expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Buen avance')).toBeInTheDocument();
    expect(screen.getByText('Borrador guardado')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }));
    expect(await screen.findByText('Ingresa una calificación.')).toBeInTheDocument(); // Innovación is empty
    expect(callsTo(fetchMock, 'POST /evaluations')).toHaveLength(0);

    await user.type(screen.getByLabelText('Calificación (0–10)', { selector: '#score-c2' }), '11');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByText('Debe estar entre 0 y 10.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Calificación (0–10)', { selector: '#score-c2' }));
    await user.type(screen.getByLabelText('Calificación (0–10)', { selector: '#score-c2' }), '9');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByText(/Borrador guardado\. Puedes volver/)).toBeInTheDocument();
    const draftBody = JSON.parse(String(callsTo(fetchMock, 'POST /evaluations')[0][1]!.body));
    expect(draftBody).toMatchObject({ projectId: project.id, submit: false });
    expect(draftBody.scores).toEqual([
      { criterionId: 'c1', score: 7, comments: 'Buen avance' },
      { criterionId: 'c2', score: 9, comments: null },
    ]);

    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }));
    expect(await screen.findByText('¿Enviar tu evaluación definitiva?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, enviar' }));
    expect(await screen.findByText('Evaluación enviada. ¡Gracias!')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, 'POST /evaluations')[1][1]!.body)).submit).toBe(true);
    await waitFor(() => expect(screen.getByLabelText('Calificación (0–10)', { selector: '#score-c1' })).toBeDisabled());
  });

  it('is read-only until the evaluation starts, and shows the conflict-of-interest message', async () => {
    openAs('JUDGE', 'evaluation', {
      [`GET ${base}/evaluation`]: () => jsonResponse(200, evaluation({ canEdit: false, project: { ...evaluation().project, status: 'SUBMITTED' } })),
    });
    expect(await screen.findByText(/Aún no puedes calificar/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar evaluación' })).not.toBeInTheDocument();
  });

  it('blocks the screen on a conflict of interest (403)', async () => {
    openAs('JUDGE', 'evaluation', {
      [`GET ${base}/evaluation`]: () => jsonResponse(403, { error: 'conflict', code: 'CONFLICT_OF_INTEREST' }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('eres autor o colaborador');
  });
});

describe('AI assistant tab', () => {
  const sources = [{ documentId: 'd1', fileName: 'sensores.txt', chunkIndex: 0, pageNumber: null, similarity: 0.8, excerpt: 'Los sensores detectan fiebre' }];

  it('shows answers labeled as AI with sources, the fallback message, errors, and reports an answer', async () => {
    let n = 0;
    const fetchMock = signedInAs(makeUser('RESEARCHER', { id: project.ownerId }), {
      [`GET ${base}`]: () => jsonResponse(200, project),
      [`GET ${base}/collaborators`]: () => jsonResponse(200, { data: [] }),
      [`GET ${base}/ai-history`]: () => jsonResponse(200, { data: [] }),
      [`POST ${base}/ask`]: () => {
        n += 1;
        if (n === 1) return jsonResponse(200, { interactionId: 'i1', answer: 'Detectan fiebre.', message: null, fallback: false, aiGenerated: true, confidence: 0.8, sources });
        if (n === 2) return jsonResponse(200, { interactionId: 'i2', answer: null, message: 'Sin información', fallback: true, aiGenerated: false, confidence: 0, sources: [] });
        return jsonResponse(503, { error: 'down', code: 'AI_UNAVAILABLE' });
      },
      '/ai/interactions/i1/flag': () => jsonResponse(200, { flagged: true }),
      'POST /ai/interactions/i1/flag': () => jsonResponse(200, { flagged: true }),
    });
    renderApp(`${base}?tab=ai`);
    const user = userEvent.setup();
    const box = await screen.findByLabelText('Tu pregunta');

    await user.type(box, '¿Qué detectan los sensores?');
    await user.click(screen.getByRole('button', { name: 'Preguntar' }));
    expect(await screen.findByText('Detectan fiebre.')).toBeInTheDocument();
    expect(screen.getByText('Generado por IA')).toBeInTheDocument(); // AIR-009
    expect(screen.getByText('Fuentes (1)')).toBeInTheDocument(); // AIR-003
    expect(JSON.parse(String(callsTo(fetchMock, `POST ${base}/ask`)[0][1]!.body))).toEqual({ question: '¿Qué detectan los sensores?' });

    await user.click(screen.getByRole('button', { name: 'Reportar respuesta incorrecta' }));
    expect(await screen.findByText(/Reportada como incorrecta/)).toBeInTheDocument(); // AIR-007

    await user.type(screen.getByLabelText('Tu pregunta'), 'algo sin relación');
    await user.click(screen.getByRole('button', { name: 'Preguntar' }));
    expect(await screen.findByText(/Sin información/)).toBeInTheDocument(); // FR-008: no invented answer
    expect(screen.getAllByText('Generado por IA')).toHaveLength(1);

    await user.type(screen.getByLabelText('Tu pregunta'), 'otra pregunta');
    await user.click(screen.getByRole('button', { name: 'Preguntar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no está disponible temporalmente'); // FR-028
    expect(screen.getByLabelText('Tu pregunta')).toHaveValue('otra pregunta'); // not lost
  });

  it('is not offered to investors', async () => {
    openAs('INVESTOR', 'overview', {});
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Asistente IA' })).not.toBeInTheDocument();
  });
});

describe('progress tab', () => {
  it('lets the team add and complete milestones; is read-only once under evaluation', async () => {
    const draft = makeProject({ status: 'DRAFT' });
    let list = { data: [] as unknown[], progressPercent: 0 };
    const fetchMock = signedInAs(makeUser('RESEARCHER', { id: draft.ownerId }), {
      [`GET /projects/${draft.id}`]: () => jsonResponse(200, draft),
      [`GET /projects/${draft.id}/collaborators`]: () => jsonResponse(200, { data: [] }),
      [`GET /projects/${draft.id}/milestones`]: () => jsonResponse(200, list),
      [`POST /projects/${draft.id}/milestones`]: ({ init }) => {
        const body = JSON.parse(String(init!.body));
        list = {
          data: [{ id: 'm1', title: body.title, dueDate: body.dueDate, completed: false, completedAt: null, createdAt: '2026-10-01T00:00:00Z' }],
          progressPercent: 0,
        };
        return jsonResponse(201, list);
      },
      [`PUT /projects/${draft.id}/milestones/m1`]: () => {
        list = { data: [{ ...(list.data[0] as object), completed: true, completedAt: '2026-10-02T00:00:00Z' }], progressPercent: 100 };
        return jsonResponse(200, list);
      },
    });
    renderApp(`/projects/${draft.id}?tab=progress`);
    const user = userEvent.setup();
    expect(await screen.findByText('Aún no hay hitos')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Agregar hito' }));
    expect(screen.getByText('Escribe el nombre del hito.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Hito'), 'Recolección de datos');
    await user.click(screen.getByRole('button', { name: 'Agregar hito' }));
    expect(await screen.findByText('Recolección de datos')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(fetchMock, `POST /projects/${draft.id}/milestones`)[0][1]!.body))).toEqual({
      title: 'Recolección de datos',
      dueDate: null,
    });

    await user.click(screen.getByRole('checkbox', { name: /Marcar «Recolección de datos»/ }));
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Avance del proyecto' })).toHaveAttribute('aria-valuenow', '100'));
  });

  it('hides edit controls and explains the lock when the project is under evaluation', async () => {
    const owner = makeUser('RESEARCHER');
    signedInAs(owner, {
      [`GET ${base}`]: () => jsonResponse(200, { ...project, ownerId: owner.id }),
      [`GET ${base}/collaborators`]: () => jsonResponse(200, { data: [] }),
      [`GET ${base}/milestones`]: () => jsonResponse(200, { data: [], progressPercent: 0 }),
    });
    renderApp(`${base}?tab=progress`);
    expect(await screen.findByText(/El avance está bloqueado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar hito' })).not.toBeInTheDocument();
  });
});

describe('results tab', () => {
  it('shows scores once closed and downloads the PDF report for investors/judges/admins only', async () => {
    const closed = makeProject({ status: 'EVALUATED', allowedNextStatuses: [] });
    signedInAs(makeUser('JUDGE'), {
      [`GET /projects/${closed.id}`]: () => jsonResponse(200, closed),
      [`GET /projects/${closed.id}/documents`]: () => jsonResponse(200, { data: [] }),
      [`GET /projects/${closed.id}/results`]: () =>
        jsonResponse(200, {
          projectId: closed.id,
          status: 'EVALUATED',
          closed: true,
          judgesAssigned: 2,
          judgesCompleted: 2,
          results: {
            overallPercent: 86.7,
            criteria: [{ criterionId: 'c1', name: 'Viabilidad', maxScore: 10, weight: 2, average: 9, comments: [{ judge: null, comment: 'Excelente' }] }],
          },
        }),
    });
    renderApp(`/projects/${closed.id}?tab=results`);
    expect(await screen.findByText('Viabilidad')).toBeInTheDocument();
    expect(screen.getByText('Excelente')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Calificación global ponderada' })).toHaveAttribute('aria-valuenow', '87');
    expect(screen.getByRole('button', { name: 'Descargar reporte PDF' })).toBeInTheDocument();
  });

  it('researchers see the "not yet available" state and no report button', async () => {
    const owner = makeUser('RESEARCHER');
    signedInAs(owner, {
      [`GET ${base}`]: () => jsonResponse(200, { ...project, ownerId: owner.id }),
      [`GET ${base}/collaborators`]: () => jsonResponse(200, { data: [] }),
      [`GET ${base}/results`]: () =>
        jsonResponse(200, { projectId: project.id, status: 'UNDER_EVALUATION', closed: false, judgesAssigned: 2, judgesCompleted: 1, results: null }),
    });
    renderApp(`${base}?tab=results`);
    expect(await screen.findByText('Los resultados aún no están disponibles')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descargar reporte PDF' })).not.toBeInTheDocument();
  });
});

describe('notifications', () => {
  it('shows the unread counter in the sidebar and marks notifications as read', async () => {
    const researcher = makeUser('RESEARCHER');
    let unread = 2;
    const items = [
      { id: 'n1', projectId: project.id, type: 'PROJECT_STATUS', title: 'Proyecto evaluado', message: 'Ya hay resultados', isRead: false, createdAt: '2026-10-20T10:00:00Z', readAt: null },
      { id: 'n2', projectId: null, type: 'SYSTEM', title: 'Bienvenida', message: 'Hola', isRead: false, createdAt: '2026-10-19T10:00:00Z', readAt: null },
    ];
    const fetchMock = signedInAs(researcher, {
      'GET /notifications': () => jsonResponse(200, { data: items, total: 2, unread, limit: 10, offset: 0 }),
      'PUT /notifications/read-all': () => {
        unread = 0;
        items.forEach((i) => (i.isRead = true));
        return jsonResponse(200, { updated: 2 });
      },
    });
    renderApp('/notifications');

    expect(await screen.findByText('Proyecto evaluado')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: /Notificaciones/ })).toHaveTextContent('2'));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => expect(callsTo(fetchMock, 'PUT /notifications/read-all')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled());
  });
});

describe('admin: investor links and AI log', () => {
  it('links an investor to a project and shows backend conflicts', async () => {
    const admin = makeUser('ADMINISTRATOR');
    const inv = makeUser('INVESTOR', { fullName: 'Ines Inversionista' });
    let status = 409;
    signedInAs(admin, {
      'GET /investor-links': () => jsonResponse(200, { data: [], total: 0, limit: 10, offset: 0 }),
      'GET /users': () => jsonResponse(200, { data: [inv], total: 1, limit: 100, offset: 0 }),
      'GET /projects': () => jsonResponse(200, { data: [project], total: 1, limit: 100, offset: 0 }),
      'POST /investor-links': () =>
        status === 409
          ? jsonResponse(409, { error: 'dup' })
          : jsonResponse(201, { id: 'l1', investorId: inv.id, projectId: project.id, createdAt: '2026-10-22T00:00:00Z', investor: { id: inv.id, fullName: inv.fullName, email: inv.email }, project: { id: project.id, title: project.title, status: 'UNDER_EVALUATION' } }),
    });
    renderApp('/admin/investors');
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Ines Inversionista' });
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(screen.getByText('Elige un inversionista y un proyecto.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Inversionista'), inv.id);
    await user.selectOptions(screen.getByLabelText('Proyecto'), project.id);
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText('Ese inversionista ya está vinculado a ese proyecto.')).toBeInTheDocument();
    status = 201;
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText(/ahora ve «Proyecto de prueba»/)).toBeInTheDocument();
  });

  it('lists AI interactions and filters the reported ones', async () => {
    const fetchMock = signedInAs(makeUser('ADMINISTRATOR'), {
      'GET /ai/interactions': () =>
        jsonResponse(200, {
          data: [{ id: 'i1', user: 'Rosa', project: { id: project.id, title: 'Proyecto X' }, question: '¿Qué mide?', answer: 'Temperatura', fallback: false, flagged: true, confidence: 0.82, latencyMs: 120, model: 'mock-extractive', createdAt: '2026-10-22T10:00:00Z' }],
          total: 1,
          limit: 10,
          offset: 0,
        }),
    });
    renderApp('/admin/ai');
    expect(await screen.findByText('¿Qué mide?')).toBeInTheDocument();
    expect(screen.getByText('Reportada')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByLabelText('Mostrar solo respuestas reportadas'));
    await waitFor(() => expect(callsTo(fetchMock, 'GET /ai/interactions').length).toBe(2));
    expect(String(callsTo(fetchMock, 'GET /ai/interactions')[1][0])).toContain('flagged=true');
  });
});
