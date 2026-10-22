import type { ProjectStatus, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestDocument } from '../src/ai';
import { MockEmbeddingProvider, setEmbeddingProviderForTests } from '../src/ai/embeddings';
import { setLlmProviderForTests } from '../src/ai/llm';
import { prisma } from '../src/db/prisma';
import { setStorageForTests } from '../src/documents/storage';
import { makeDocument, MIME, TempDirStorage } from './ai-helpers';
import { api, bearer, loginAs, makeUser, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function as(role: Role, affiliation: string | null = null) {
  const user = await makeUser(role);
  if (affiliation !== null) await prisma.user.update({ where: { id: user.id }, data: { affiliation } });
  const { token } = await loginAs(user.email);
  return { user, token, h: bearer(token) };
}
type Actor = Awaited<ReturnType<typeof as>>;

const mkProject = (ownerId: string, status: ProjectStatus = 'UNDER_EVALUATION') =>
  prisma.project.create({
    data: { ownerId, title: 'Monitoreo de ganado', description: 'desc', status, affiliation: 'UNIPOLI' },
  });

async function rubric() {
  const admin = await makeUser('ADMINISTRATOR');
  const a = await prisma.evaluationCriterion.create({
    data: { name: 'Viabilidad', maxScore: 10, weight: 2, position: 0, createdById: admin.id },
  });
  const b = await prisma.evaluationCriterion.create({
    data: { name: 'Innovación', maxScore: 10, weight: 1, position: 1, createdById: admin.id },
  });
  return { a, b };
}

/** Owner + project under evaluation + one assigned judge (+ optional second). */
async function world(judges = 1) {
  const admin = await as('ADMINISTRATOR');
  const owner = await as('RESEARCHER', 'UNIPOLI');
  const project = await mkProject(owner.user.id);
  const js: Actor[] = [];
  for (let i = 0; i < judges; i++) {
    const j = await as('JUDGE', `Otra U ${i}`);
    await prisma.judgeAssignment.create({ data: { projectId: project.id, judgeId: j.user.id, assignedById: admin.user.id } });
    js.push(j);
  }
  return { admin, owner, project, judges: js, ...(await rubric()) };
}

describe('evaluations (FR-012, FR-029, BR-002, BR-003)', () => {
  it('only judges can evaluate; unassigned judges get 404; owners/collaborators are blocked (COI)', async () => {
    const w = await world();
    const body = (c: { id: string }) => ({ projectId: w.project.id, scores: [{ criterionId: c.id, score: 5 }] });
    expect((await api().post('/evaluations').send(body(w.a))).status).toBe(401);
    expect((await api().post('/evaluations').set(w.owner.h).send(body(w.a))).status).toBe(403);
    const stranger = await as('JUDGE', 'X');
    expect((await api().post('/evaluations').set(stranger.h).send(body(w.a))).status).toBe(404);

    // The judge later becomes a collaborator: re-checked on every access.
    await prisma.projectCollaborator.create({ data: { projectId: w.project.id, userId: w.judges[0]!.user.id } });
    const res = await api().post('/evaluations').set(w.judges[0]!.h).send(body(w.a));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
  });

  it('saves a draft, recovers it, and blocks an incomplete final submission', async () => {
    const w = await world();
    const j = w.judges[0]!;
    const draft = await api()
      .post('/evaluations')
      .set(j.h)
      .send({ projectId: w.project.id, scores: [{ criterionId: w.a.id, score: 7.5, comments: 'Bien' }], submit: false });
    expect(draft.status).toBe(200);
    expect(draft.body.state).toBe('DRAFT');

    const recovered = await api().get(`/projects/${w.project.id}/evaluation`).set(j.h);
    expect(recovered.body.state).toBe('DRAFT');
    expect(recovered.body.canEdit).toBe(true);
    expect(recovered.body.criteria.find((c: { criterionId: string }) => c.criterionId === w.a.id)).toMatchObject({ score: 7.5, comments: 'Bien' });

    const incomplete = await api().post('/evaluations').set(j.h).send({ projectId: w.project.id, scores: [], submit: true });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.code).toBe('INCOMPLETE_EVALUATION');
    expect(incomplete.body.missing).toEqual([{ criterionId: w.b.id, name: 'Innovación' }]);
    expect((await prisma.judgeAssignment.findFirstOrThrow()).status).toBe('IN_PROGRESS');
  });

  it('validates scores and project state', async () => {
    const w = await world();
    const j = w.judges[0]!;
    const over = await api().post('/evaluations').set(j.h).send({ projectId: w.project.id, scores: [{ criterionId: w.a.id, score: 11 }] });
    expect(over.status).toBe(422);
    const unknown = await api().post('/evaluations').set(j.h).send({ projectId: w.project.id, scores: [{ criterionId: randomUUID(), score: 1 }] });
    expect(unknown.status).toBe(422);
    await prisma.project.update({ where: { id: w.project.id }, data: { status: 'SUBMITTED' } });
    const early = await api().post('/evaluations').set(j.h).send({ projectId: w.project.id, scores: [] });
    expect(early.status).toBe(409);
  });

  it('closes the project when the last judge submits; scores stay hidden from the researcher until then (BR-003)', async () => {
    const w = await world(2);
    const [j1, j2] = w.judges as [Actor, Actor];
    const full = (a: number, b: number) => ({
      projectId: w.project.id,
      submit: true,
      scores: [
        { criterionId: w.a.id, score: a, comments: `c${a}` },
        { criterionId: w.b.id, score: b },
      ],
    });

    expect((await api().post('/evaluations').set(j1.h).send(full(8, 6))).status).toBe(201);
    const second = await api().post('/evaluations').set(j1.h).send(full(8, 6));
    expect(second.status).toBe(409); // already submitted

    const mid = await api().get(`/projects/${w.project.id}/results`).set(w.owner.h);
    expect(mid.body).toMatchObject({ closed: false, results: null, judgesAssigned: 2, judgesCompleted: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: w.project.id } })).status).toBe('UNDER_EVALUATION');

    const last = await api().post('/evaluations').set(j2.h).send(full(10, 10));
    expect(last.status).toBe(201);
    expect(last.body.projectClosed).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: w.project.id } })).status).toBe('EVALUATED');

    const end = await api().get(`/projects/${w.project.id}/results`).set(w.owner.h);
    expect(end.body.closed).toBe(true);
    const viab = end.body.results.criteria.find((c: { name: string }) => c.name === 'Viabilidad');
    expect(viab.average).toBe(9);
    expect(viab.comments.every((c: { judge: string | null }) => c.judge === null)).toBe(true); // anonymous for the team
    // (0.9*2 + 0.8*1) / 3 = 0.8667 -> 86.7
    expect(end.body.results.overallPercent).toBe(86.7);
    expect(end.body.results.byJudge).toBeUndefined();

    const adminView = await api().get(`/projects/${w.project.id}/results`).set(w.admin.h);
    expect(adminView.body.results.byJudge).toHaveLength(4);

    // Admins were told per submission; the team once the period closed.
    expect(await prisma.notification.count({ where: { userId: w.admin.user.id, type: 'EVALUATION_SUBMITTED' } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: w.owner.user.id, type: 'PROJECT_STATUS' } })).toBe(1);
  });
});

describe('investors (BR-005, BR-007, FR-015, FR-016, FR-018)', () => {
  it('admin links an investor; the dashboard shows ONLY linked projects, with filters and no scores before closing', async () => {
    const w = await world();
    const investor = await as('INVESTOR');
    const other = await as('INVESTOR');
    const hidden = await mkProject(w.owner.user.id, 'SUBMITTED');
    await prisma.project.update({ where: { id: hidden.id }, data: { researchArea: 'Otra' } });

    expect((await api().post('/investor-links').set(w.owner.h).send({ investorId: investor.user.id, projectId: w.project.id })).status).toBe(403);
    const link = await api().post('/investor-links').set(w.admin.h).send({ investorId: investor.user.id, projectId: w.project.id });
    expect(link.status).toBe(201);
    expect((await api().post('/investor-links').set(w.admin.h).send({ investorId: investor.user.id, projectId: w.project.id })).status).toBe(409);
    expect((await api().post('/investor-links').set(w.admin.h).send({ investorId: w.owner.user.id, projectId: w.project.id })).status).toBe(422);

    const dash = await api().get(`/investors/${investor.user.id}/dashboard`).set(investor.h);
    expect(dash.status).toBe(200);
    expect(dash.body.data.map((p: { id: string }) => p.id)).toEqual([w.project.id]);
    expect(dash.body.summary.totalLinked).toBe(1);
    expect(dash.body.data[0].evaluation).toMatchObject({ closed: false, overallPercent: null });

    const filtered = await api().get(`/investors/${investor.user.id}/dashboard?status=EVALUATED`).set(investor.h);
    expect(filtered.body.data).toHaveLength(0);

    // Another investor (or reading someone else's dashboard) gets nothing / 403.
    expect((await api().get(`/investors/${investor.user.id}/dashboard`).set(other.h)).status).toBe(403);
    expect((await api().get(`/investors/${other.user.id}/dashboard`).set(other.h)).body.data).toEqual([]);
    expect((await api().get(`/investors/${investor.user.id}/dashboard`).set(w.owner.h)).status).toBe(403);
    expect(await prisma.notification.count({ where: { userId: investor.user.id } })).toBe(1);
  });

  it('investors are strictly read-only on project data', async () => {
    const w = await world();
    const investor = await as('INVESTOR');
    await prisma.investorProjectLink.create({ data: { investorId: investor.user.id, projectId: w.project.id, linkedById: w.admin.user.id } });
    expect((await api().put(`/projects/${w.project.id}`).set(investor.h).send({ title: 'hack' })).status).toBe(403);
    expect((await api().post(`/projects/${w.project.id}/milestones`).set(investor.h).send({ title: 'x' })).status).toBe(403);
    expect((await api().post(`/projects/${w.project.id}/ask`).set(investor.h).send({ question: 'hola?' })).status).toBe(403);
    expect((await api().get(`/projects/${w.project.id}/milestones`).set(investor.h)).status).toBe(200);
  });

  it('serves a PDF report to the linked investor and assigned judge only', async () => {
    const w = await world();
    const investor = await as('INVESTOR');
    const unlinked = await as('INVESTOR');
    await prisma.investorProjectLink.create({ data: { investorId: investor.user.id, projectId: w.project.id, linkedById: w.admin.user.id } });

    const ok = await api().get(`/projects/${w.project.id}/report`).set(investor.h).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect((ok.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await api().get(`/projects/${w.project.id}/report`).set(unlinked.h)).status).toBe(404);
    expect((await api().get(`/projects/${w.project.id}/report`).set(w.owner.h)).status).toBe(403);
    expect((await api().get(`/projects/${w.project.id}/report`).set(w.judges[0]!.h)).status).toBe(200);
  });
});

describe('milestones and progress (FR-017)', () => {
  it('team creates, completes and deletes milestones; progress is computed; blocked under evaluation', async () => {
    const owner = await as('RESEARCHER', 'UNIPOLI');
    const outsider = await as('RESEARCHER', 'Otra');
    const project = await mkProject(owner.user.id, 'DRAFT');

    const a = await api().post(`/projects/${project.id}/milestones`).set(owner.h).send({ title: 'Revisión', dueDate: '2026-12-01' });
    expect(a.status).toBe(201);
    await api().post(`/projects/${project.id}/milestones`).set(owner.h).send({ title: 'Experimentos' });
    const done = await api().put(`/projects/${project.id}/milestones/${a.body.milestone.id}`).set(owner.h).send({ completed: true });
    expect(done.body.progressPercent).toBe(50);
    expect((await api().get(`/projects/${project.id}/milestones`).set(outsider.h)).status).toBe(404);
    expect((await api().post(`/projects/${project.id}/milestones`).set(owner.h).send({ title: '' })).status).toBe(400);
    expect((await api().post(`/projects/${project.id}/milestones`).set(owner.h).send({ title: 'x', dueDate: 'mañana' })).status).toBe(400);

    await prisma.project.update({ where: { id: project.id }, data: { status: 'UNDER_EVALUATION' } });
    expect((await api().post(`/projects/${project.id}/milestones`).set(owner.h).send({ title: 'tarde' })).status).toBe(409);
    await prisma.project.update({ where: { id: project.id }, data: { status: 'SUBMITTED' } });
    expect((await api().delete(`/projects/${project.id}/milestones/${a.body.milestone.id}`).set(owner.h)).status).toBe(204);
  });
});

describe('notifications (FR-019)', () => {
  it('are private to their owner, listable, and markable as read', async () => {
    const me = await as('RESEARCHER');
    const other = await as('STUDENT');
    const n1 = await prisma.notification.create({ data: { userId: me.user.id, title: 'A', message: 'a' } });
    await prisma.notification.create({ data: { userId: me.user.id, title: 'B', message: 'b' } });
    await prisma.notification.create({ data: { userId: other.user.id, title: 'C', message: 'c' } });

    const list = await api().get('/notifications').set(me.h);
    expect(list.body).toMatchObject({ total: 2, unread: 2 });
    expect((await api().put(`/notifications/${n1.id}/read`).set(other.h)).status).toBe(404);
    expect((await api().put(`/notifications/${n1.id}/read`).set(me.h)).body.isRead).toBe(true);
    expect((await api().get('/notifications?unread=true').set(me.h)).body.total).toBe(1);
    expect((await api().put('/notifications/read-all').set(me.h)).body.updated).toBe(1);
    expect((await api().get('/notifications').set(me.h)).body.unread).toBe(0);
    expect((await api().get('/notifications').set(other.h)).body.unread).toBe(1);
    expect((await api().get('/notifications')).status).toBe(401);
  });

  it('assigning a judge, adding a collaborator and submitting a project notify the right people', async () => {
    const admin = await as('ADMINISTRATOR');
    const owner = await as('RESEARCHER', 'UNIPOLI');
    const student = await as('STUDENT');
    const judge = await as('JUDGE', 'Otra');
    const project = await mkProject(owner.user.id, 'DRAFT');

    await api().post(`/projects/${project.id}/collaborators`).set(owner.h).send({ email: student.user.email, role: 'MEMBER' });
    expect(await prisma.notification.count({ where: { userId: student.user.id, type: 'COLLABORATOR_ADDED' } })).toBe(1);

    await api().put(`/projects/${project.id}/status`).set(owner.h).send({ status: 'SUBMITTED' });
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'PROJECT_STATUS' } })).toBe(1);

    await api().post('/judge-assignments').set(admin.h).send({ projectId: project.id, judgeId: judge.user.id });
    expect(await prisma.notification.count({ where: { userId: judge.user.id, type: 'JUDGE_ASSIGNED' } })).toBe(1);

    await api().put(`/projects/${project.id}/status`).set(admin.h).send({ status: 'UNDER_EVALUATION' });
    expect(await prisma.notification.count({ where: { userId: judge.user.id, type: 'PROJECT_STATUS' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: student.user.id, type: 'PROJECT_STATUS' } })).toBe(1);
  });
});

describe('AI assistant (FR-007, FR-008, FR-028, AIR-003..005, AIR-007)', () => {
  let storage: TempDirStorage;
  const mock = new MockEmbeddingProvider();

  beforeAll(async () => {
    storage = await TempDirStorage.create();
    setStorageForTests(storage);
    setEmbeddingProviderForTests(mock);
  });
  afterEach(() => setLlmProviderForTests(undefined));
  afterAll(async () => {
    setStorageForTests(undefined);
    setEmbeddingProviderForTests(undefined);
    await storage.dispose();
  });

  async function indexed() {
    const owner = await as('RESEARCHER', 'UNIPOLI');
    const project = await mkProject(owner.user.id, 'DRAFT');
    const doc = await makeDocument({
      storage,
      projectId: project.id,
      uploadedById: owner.user.id,
      fileName: 'sensores.txt',
      mimeType: MIME.txt,
      data: Buffer.from('Los sensores de temperatura detectan fiebre en el ganado con tres horas de anticipación.', 'utf8'),
    });
    expect((await ingestDocument(doc.id)).status).toBe('READY');
    return { owner, project, doc };
  }

  it('answers with citations, logs the interaction, lets the user flag it and the admin review it', async () => {
    const { owner, project, doc } = await indexed();
    const res = await api().post(`/projects/${project.id}/ask`).set(owner.h).send({ question: 'sensores de temperatura fiebre en el ganado' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fallback: false, aiGenerated: true });
    expect(res.body.answer).toContain('sensores');
    expect(res.body.sources[0]).toMatchObject({ documentId: doc.id, fileName: 'sensores.txt' });
    expect(await prisma.retrievalAuditLog.count({ where: { interactionId: res.body.interactionId } })).toBeGreaterThan(0);

    const history = await api().get(`/projects/${project.id}/ai-history`).set(owner.h);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].sources[0].fileName).toBe('sensores.txt');

    const other = await as('RESEARCHER', 'Otra');
    expect((await api().post(`/ai/interactions/${res.body.interactionId}/flag`).set(other.h)).status).toBe(404);
    expect((await api().post(`/ai/interactions/${res.body.interactionId}/flag`).set(owner.h)).body.flagged).toBe(true);

    const admin = await as('ADMINISTRATOR');
    const log = await api().get('/ai/interactions?flagged=true').set(admin.h);
    expect(log.body.total).toBe(1);
    expect((await api().get('/ai/interactions').set(owner.h)).status).toBe(403);
  });

  it('falls back (no LLM call) when nothing relevant is found, and with no documents', async () => {
    const { owner, project } = await indexed();
    let called = false;
    setLlmProviderForTests({ answer: async () => ((called = true), { text: 'x', model: 'm' }) });
    const res = await api().post(`/projects/${project.id}/ask`).set(owner.h).send({ question: 'zzzz qqqq xxxx wwww' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fallback: true, answer: null, aiGenerated: false, sources: [] });
    expect(called).toBe(false);

    const emptyProject = await mkProject(owner.user.id, 'DRAFT');
    const empty = await api().post(`/projects/${emptyProject.id}/ask`).set(owner.h).send({ question: 'hay algo aquí?' });
    expect(empty.body.fallback).toBe(true);
  });

  it('answers 503 AI_UNAVAILABLE when the LLM fails, and enforces project access and validation', async () => {
    const { owner, project } = await indexed();
    setLlmProviderForTests({
      answer: async () => {
        throw new Error('boom');
      },
    });
    const down = await api().post(`/projects/${project.id}/ask`).set(owner.h).send({ question: 'sensores de temperatura fiebre' });
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('AI_UNAVAILABLE');

    const outsider = await as('RESEARCHER', 'Otra');
    expect((await api().post(`/projects/${project.id}/ask`).set(outsider.h).send({ question: 'sensores?' })).status).toBe(404);
    expect((await api().post(`/projects/${project.id}/ask`).set(owner.h).send({ question: 'a' })).status).toBe(400);
    expect((await api().post(`/projects/${project.id}/ask`).send({ question: 'hola mundo' })).status).toBe(401);
  });
});
