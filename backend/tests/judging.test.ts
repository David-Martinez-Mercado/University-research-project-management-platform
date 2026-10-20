import type { ProjectStatus, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { evaluateConflictOfInterest, normalizeAffiliation } from '../src/judging/judging.coi';
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

const mkProject = (ownerId: string, over: { status?: ProjectStatus; affiliation?: string | null } = {}) =>
  prisma.project.create({
    data: {
      ownerId,
      title: 'Quantum sensing',
      description: 'desc',
      status: over.status ?? 'SUBMITTED',
      affiliation: over.affiliation === undefined ? 'Universidad Politecnica de Durango' : over.affiliation,
    },
  });

const assign = (admin: Actor, projectId: string, judgeId: string) =>
  api().post('/judge-assignments').set(admin.h).send({ projectId, judgeId });

const countAssignments = () => prisma.judgeAssignment.count();

/** Admin + researcher-owned SUBMITTED project (affiliation "Universidad Politecnica de Durango"). */
async function world() {
  const admin = await as('ADMINISTRATOR');
  const owner = await as('RESEARCHER', 'Universidad Politecnica de Durango');
  const project = await mkProject(owner.user.id);
  return { admin, owner, project };
}

describe('authentication and RBAC', () => {
  it('returns 401 without a token on every endpoint', async () => {
    const id = randomUUID();
    const calls = [
      api().post('/judge-assignments').send({}),
      api().get('/judge-assignments'),
      api().delete(`/judge-assignments/${id}`),
      api().get(`/judges/${id}/projects`),
    ];
    for (const c of calls) expect((await c).status).toBe(401);
  });

  it.each(['RESEARCHER', 'STUDENT', 'JUDGE', 'INVESTOR'] as const)('forbids %s on /judge-assignments (403)', async (role) => {
    const { project } = await world();
    const judge = await as('JUDGE', 'MIT');
    const a = await as(role);
    expect((await assign(a, project.id, judge.user.id)).status).toBe(403);
    expect((await api().get('/judge-assignments').set(a.h)).status).toBe(403);
    expect((await api().delete(`/judge-assignments/${randomUUID()}`).set(a.h)).status).toBe(403);
    expect(await countAssignments()).toBe(0);
  });

  it.each(['RESEARCHER', 'STUDENT', 'INVESTOR'] as const)('forbids %s on GET /judges/:id/projects (403)', async (role) => {
    const judge = await as('JUDGE', 'MIT');
    const a = await as(role);
    expect((await api().get(`/judges/${judge.user.id}/projects`).set(a.h)).status).toBe(403);
    expect((await api().get(`/judges/${a.user.id}/projects`).set(a.h)).status).toBe(403); // not even their own id
  });
});

describe('POST /judge-assignments - conflict of interest (FR-010) BLOCKS the assignment', () => {
  it('succeeds for a judge with a different affiliation', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'Massachusetts Institute of Technology');
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      projectId: project.id,
      judgeId: judge.user.id,
      assignedById: admin.user.id,
      status: 'ASSIGNED',
      completedAt: null,
      judge: { id: judge.user.id, affiliation: 'Massachusetts Institute of Technology' },
      project: { id: project.id, status: 'SUBMITTED' },
    });
    expect(await countAssignments()).toBe(1);
  });

  it.each([
    ['identical', 'Universidad Politecnica de Durango'],
    ['different case', 'UNIVERSIDAD POLITECNICA DE DURANGO'],
    ['extra / odd whitespace', '  universidad   politecnica\tde  durango '],
    ['accents', 'Universidad Politécnica de Durango'],
  ])('rejects (422) a judge with the same affiliation: %s', async (_label, affiliation) => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', affiliation);
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
    expect(res.body.error).toMatch(/conflict of interest/i);
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'SAME_AFFILIATION' })]);
    expect(await countAssignments()).toBe(0); // rejected, NOT created with a warning
    expect(
      (await api().get(`/judges/${judge.user.id}/projects`).set(admin.h)).body.total,
    ).toBe(0);
  });

  it('rejects (422) a judge who OWNS the project, even with a different affiliation', async () => {
    const admin = await as('ADMINISTRATOR');
    const judge = await as('JUDGE', 'MIT');
    const project = await mkProject(judge.user.id, { affiliation: 'Somewhere Else' });
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'JUDGE_IS_OWNER' })]);
    expect(await countAssignments()).toBe(0);
  });

  it('rejects (422) a judge who COLLABORATES on the project, even with a different affiliation', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: judge.user.id, role: 'MEMBER' } });
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'JUDGE_IS_COLLABORATOR' })]);
    expect(await countAssignments()).toBe(0);
  });

  it('reports every reason at once', async () => {
    const admin = await as('ADMINISTRATOR');
    const judge = await as('JUDGE', 'Same Place');
    const project = await mkProject(judge.user.id, { affiliation: 'same place' });
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: judge.user.id } });
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(422);
    expect(res.body.reasons.map((r: { code: string }) => r.code).sort()).toEqual(
      ['JUDGE_IS_COLLABORATOR', 'JUDGE_IS_OWNER', 'SAME_AFFILIATION'].sort(),
    );
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('FAILS CLOSED when the judge affiliation is missing (%s)', async (_label, affiliation) => {
    const { admin, project } = await world();
    const judge = await as('JUDGE');
    if (affiliation !== null) await prisma.user.update({ where: { id: judge.user.id }, data: { affiliation } });
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AFFILIATION_REQUIRED');
    expect(res.body.error).toMatch(/fill it in/i);
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'JUDGE_AFFILIATION_MISSING' })]);
    expect(await countAssignments()).toBe(0);
  });

  it('FAILS CLOSED when the project affiliation is missing', async () => {
    const admin = await as('ADMINISTRATOR');
    const owner = await as('RESEARCHER');
    const project = await mkProject(owner.user.id, { affiliation: null });
    const judge = await as('JUDGE', 'MIT');
    const res = await assign(admin, project.id, judge.user.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AFFILIATION_REQUIRED');
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'PROJECT_AFFILIATION_MISSING' })]);
    expect(await countAssignments()).toBe(0);
  });

  it('works once the admin fills the missing affiliation in', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE');
    expect((await assign(admin, project.id, judge.user.id)).status).toBe(422);
    await api().put(`/users/${judge.user.id}`).set(admin.h).send({ affiliation: 'MIT' });
    expect((await assign(admin, project.id, judge.user.id)).status).toBe(201);
  });

  it('a conflict check that races with an uncommitted collaborator insert still blocks (row locks)', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const insertedSignal = new Promise<void>((r) => (inserted = r));
    // In flight: the judge is being added as a collaborator, not yet committed.
    const holder = prisma.$transaction(async (tx) => {
      await tx.projectCollaborator.create({ data: { projectId: project.id, userId: judge.user.id } });
      inserted();
      await gate;
    });
    await insertedSignal;

    const pending = assign(admin, project.id, judge.user.id).then((r) => r);
    await new Promise((r) => setTimeout(r, 400)); // the assignment transaction is now waiting on the project lock
    release();
    await holder;

    const res = await pending;
    expect(res.status).toBe(422);
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'JUDGE_IS_COLLABORATOR' })]);
    expect(await countAssignments()).toBe(0);
  });
});

describe('POST /judge-assignments - other rules', () => {
  it('rejects a duplicate with 409 and keeps a single row', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    expect((await assign(admin, project.id, judge.user.id)).status).toBe(201);
    const dup = await assign(admin, project.id, judge.user.id);
    expect(dup.status).toBe(409);
    expect(await countAssignments()).toBe(1);
  });

  it('two simultaneous identical requests: exactly one wins, the other gets 409', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    const results = await Promise.all([assign(admin, project.id, judge.user.id), assign(admin, project.id, judge.user.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countAssignments()).toBe(1);
  });

  it('allows several judges on one project and one judge on several projects', async () => {
    const { admin, owner, project } = await world();
    const second = await mkProject(owner.user.id, { status: 'UNDER_EVALUATION' });
    const j1 = await as('JUDGE', 'MIT');
    const j2 = await as('JUDGE', 'Stanford');
    expect((await assign(admin, project.id, j1.user.id)).status).toBe(201);
    expect((await assign(admin, project.id, j2.user.id)).status).toBe(201);
    expect((await assign(admin, second.id, j1.user.id)).status).toBe(201);
  });

  it.each([
    ['DRAFT', 409],
    ['SUBMITTED', 201],
    ['UNDER_EVALUATION', 201],
    ['EVALUATED', 409],
    ['ARCHIVED', 409],
  ] as const)('project in %s -> %i', async (status, expected) => {
    const admin = await as('ADMINISTRATOR');
    const owner = await as('RESEARCHER');
    const project = await mkProject(owner.user.id, { status });
    const judge = await as('JUDGE', 'MIT');
    expect((await assign(admin, project.id, judge.user.id)).status).toBe(expected);
  });

  it('rejects users that are not active judges (422) and unknown ids (404)', async () => {
    const { admin, project } = await world();
    const researcher = await as('RESEARCHER', 'MIT');
    const inactive = await as('JUDGE', 'MIT');
    await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });
    expect((await assign(admin, project.id, researcher.user.id)).status).toBe(422);
    expect((await assign(admin, project.id, admin.user.id)).status).toBe(422);
    expect((await assign(admin, project.id, inactive.user.id)).status).toBe(422);
    expect((await assign(admin, project.id, randomUUID())).status).toBe(404);
    expect((await assign(admin, randomUUID(), (await as('JUDGE', 'MIT')).user.id)).status).toBe(404);
    expect(await countAssignments()).toBe(0);
  });

  it('validates the body strictly (400)', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    const post = (body: unknown) => api().post('/judge-assignments').set(admin.h).send(body as object);
    expect((await post({})).status).toBe(400);
    expect((await post({ projectId: project.id })).status).toBe(400);
    expect((await post({ projectId: 'x', judgeId: judge.user.id })).status).toBe(400);
    expect((await post({ projectId: project.id, judgeId: judge.user.id, assignedById: admin.user.id })).status).toBe(400);
    expect(await countAssignments()).toBe(0);
  });
});

describe('judge visibility after assignment', () => {
  it('the judge sees the project in GET /projects only once assigned, and loses it when the assignment is removed', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    expect((await api().get('/projects').set(judge.h)).body.total).toBe(0);
    expect((await api().get(`/projects/${project.id}`).set(judge.h)).status).toBe(404);

    const created = await assign(admin, project.id, judge.user.id);
    expect((await api().get('/projects').set(judge.h)).body.total).toBe(1);
    expect((await api().get(`/projects/${project.id}`).set(judge.h)).status).toBe(200);

    expect((await api().delete(`/judge-assignments/${created.body.id}`).set(admin.h)).status).toBe(204);
    expect((await api().get(`/projects/${project.id}`).set(judge.h)).status).toBe(404);
  });
});

describe('GET /judge-assignments', () => {
  it('lists, filters by projectId and paginates (admin only)', async () => {
    const { admin, owner, project } = await world();
    const other = await mkProject(owner.user.id);
    const j1 = await as('JUDGE', 'MIT');
    const j2 = await as('JUDGE', 'Stanford');
    await assign(admin, project.id, j1.user.id);
    await assign(admin, project.id, j2.user.id);
    await assign(admin, other.id, j1.user.id);

    const all = await api().get('/judge-assignments').set(admin.h);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 3, limit: 20, offset: 0 });
    const filtered = await api().get(`/judge-assignments?projectId=${project.id}`).set(admin.h);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.data.every((a: { projectId: string }) => a.projectId === project.id)).toBe(true);
    expect(filtered.body.data[0].judge).toEqual(
      expect.objectContaining({ id: expect.any(String), fullName: expect.any(String), email: expect.any(String) }),
    );
    const page = await api().get('/judge-assignments?limit=1&offset=1').set(admin.h);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.total).toBe(3);
    expect((await api().get('/judge-assignments?projectId=nope').set(admin.h)).status).toBe(400);
    expect((await api().get('/judge-assignments?limit=100000').set(admin.h)).body.limit).toBe(100);
  });
});

describe('DELETE /judge-assignments/:id', () => {
  it('removes an assignment without evaluations (204) and 404s afterwards', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    const { body } = await assign(admin, project.id, judge.user.id);
    expect((await api().delete(`/judge-assignments/${body.id}`).set(admin.h)).status).toBe(204);
    expect(await countAssignments()).toBe(0);
    expect((await api().delete(`/judge-assignments/${body.id}`).set(admin.h)).status).toBe(404);
    expect((await api().delete('/judge-assignments/nope').set(admin.h)).status).toBe(400);
  });

  it('refuses (409) when the assignment already has evaluations', async () => {
    const { admin, project } = await world();
    const judge = await as('JUDGE', 'MIT');
    const { body } = await assign(admin, project.id, judge.user.id);
    const criterion = await prisma.evaluationCriterion.create({ data: { name: 'Novelty' } });
    await prisma.evaluation.create({ data: { assignmentId: body.id, criterionId: criterion.id, score: 7 } });
    const res = await api().delete(`/judge-assignments/${body.id}`).set(admin.h);
    expect(res.status).toBe(409);
    expect(await countAssignments()).toBe(1);
    expect(await prisma.evaluation.count()).toBe(1);
  });
});

describe('GET /judges/:id/projects', () => {
  async function seed() {
    const { admin, owner, project } = await world();
    const second = await mkProject(owner.user.id, { status: 'UNDER_EVALUATION' });
    const notAssigned = await mkProject(owner.user.id);
    const judge = await as('JUDGE', 'MIT');
    const otherJudge = await as('JUDGE', 'Stanford');
    await assign(admin, project.id, judge.user.id);
    await assign(admin, second.id, judge.user.id);
    await assign(admin, notAssigned.id, otherJudge.user.id);
    return { admin, project, second, notAssigned, judge, otherJudge };
  }

  it('a judge sees exactly their own assigned projects, with the assignment info', async () => {
    const { judge, project, second } = await seed();
    const res = await api().get(`/judges/${judge.user.id}/projects`).set(judge.h);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual([project.id, second.id].sort());
    expect(res.body.data[0]).toMatchObject({
      status: expect.any(String),
      allowedNextStatuses: expect.any(Array),
      assignment: { id: expect.any(String), status: 'ASSIGNED' },
    });
  });

  it('a judge cannot read another judge (403) - the other judge sees only theirs', async () => {
    const { judge, otherJudge, notAssigned } = await seed();
    expect((await api().get(`/judges/${otherJudge.user.id}/projects`).set(judge.h)).status).toBe(403);
    const mine = await api().get(`/judges/${otherJudge.user.id}/projects`).set(otherJudge.h);
    expect(mine.body.data.map((p: { id: string }) => p.id)).toEqual([notAssigned.id]);
  });

  it('an administrator can read any judge; non-judge or unknown ids are 404', async () => {
    const { admin, judge, otherJudge } = await seed();
    expect((await api().get(`/judges/${judge.user.id}/projects`).set(admin.h)).body.total).toBe(2);
    expect((await api().get(`/judges/${otherJudge.user.id}/projects`).set(admin.h)).body.total).toBe(1);
    expect((await api().get(`/judges/${admin.user.id}/projects`).set(admin.h)).status).toBe(404);
    expect((await api().get(`/judges/${randomUUID()}/projects`).set(admin.h)).status).toBe(404);
    expect((await api().get('/judges/nope/projects').set(admin.h)).status).toBe(400);
  });

  it('paginates', async () => {
    const { judge } = await seed();
    const res = await api().get(`/judges/${judge.user.id}/projects?limit=1&offset=1`).set(judge.h);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });
});

describe('conflict-of-interest rule (pure)', () => {
  const base = {
    judge: { id: 'j', affiliation: 'MIT' },
    project: { ownerId: 'o', affiliation: 'Stanford' },
    collaboratorIds: ['c1'],
  };

  it('has no conflicts or gaps for unrelated parties', () => {
    expect(evaluateConflictOfInterest(base)).toEqual({ conflicts: [], unverifiable: [] });
  });

  it('flags each conflict type', () => {
    expect(evaluateConflictOfInterest({ ...base, project: { ownerId: 'j', affiliation: 'Stanford' } }).conflicts[0]?.code).toBe('JUDGE_IS_OWNER');
    expect(evaluateConflictOfInterest({ ...base, collaboratorIds: ['c1', 'j'] }).conflicts[0]?.code).toBe('JUDGE_IS_COLLABORATOR');
    expect(evaluateConflictOfInterest({ ...base, project: { ownerId: 'o', affiliation: ' mit ' } }).conflicts[0]?.code).toBe('SAME_AFFILIATION');
  });

  it('missing affiliations are unverifiable, never "no conflict"', () => {
    const r = evaluateConflictOfInterest({ ...base, judge: { id: 'j', affiliation: null }, project: { ownerId: 'o', affiliation: '  ' } });
    expect(r.conflicts).toEqual([]);
    expect(r.unverifiable.map((u) => u.code).sort()).toEqual(['JUDGE_AFFILIATION_MISSING', 'PROJECT_AFFILIATION_MISSING']);
  });

  it('normalizes case, whitespace and accents; blank becomes null', () => {
    expect(normalizeAffiliation('  Universidad   Politécnica\tDE Durango ')).toBe('universidad politecnica de durango');
    expect(normalizeAffiliation('')).toBeNull();
    expect(normalizeAffiliation('   ')).toBeNull();
    expect(normalizeAffiliation(null)).toBeNull();
    expect(normalizeAffiliation(undefined)).toBeNull();
  });
});
