import type { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { api, bearer, loginAs, makeUser, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function as(role: Role) {
  const user = await makeUser(role);
  const { token } = await loginAs(user.email);
  return { user, token, h: bearer(token) };
}
type Actor = Awaited<ReturnType<typeof as>>;

const mkCriterion = (name: string, position: number, over: { isActive?: boolean } = {}) =>
  prisma.evaluationCriterion.create({ data: { name, position, isActive: over.isActive ?? true } });

const names = (body: { data: Array<{ name: string }> }) => body.data.map((c) => c.name);

describe('authentication and RBAC on /criteria', () => {
  it('returns 401 without a token', async () => {
    const id = randomUUID();
    const calls = [
      api().get('/criteria'),
      api().post('/criteria').send({ name: 'x' }),
      api().put(`/criteria/${id}`).send({ name: 'x' }),
      api().get(`/projects/${id}/rubric`),
    ];
    for (const c of calls) expect((await c).status).toBe(401);
  });

  it.each(['RESEARCHER', 'STUDENT', 'INVESTOR'] as const)('forbids %s everywhere on /criteria (403)', async (role) => {
    const a = await as(role);
    const c = await mkCriterion('Novelty', 1);
    expect((await api().get('/criteria').set(a.h)).status).toBe(403);
    expect((await api().post('/criteria').set(a.h).send({ name: 'x' })).status).toBe(403);
    expect((await api().put(`/criteria/${c.id}`).set(a.h).send({ name: 'x' })).status).toBe(403);
    expect(await prisma.evaluationCriterion.count()).toBe(1);
    expect((await prisma.evaluationCriterion.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Novelty');
  });

  it('a JUDGE can read but not write', async () => {
    const judge = await as('JUDGE');
    const c = await mkCriterion('Novelty', 1);
    expect((await api().get('/criteria').set(judge.h)).status).toBe(200);
    expect((await api().post('/criteria').set(judge.h).send({ name: 'x' })).status).toBe(403);
    expect((await api().put(`/criteria/${c.id}`).set(judge.h).send({ isActive: false })).status).toBe(403);
    expect((await prisma.evaluationCriterion.findUniqueOrThrow({ where: { id: c.id } })).isActive).toBe(true);
  });
});

describe('POST /criteria', () => {
  it('creates with defaults and records the creator', async () => {
    const admin = await as('ADMINISTRATOR');
    const res = await api().post('/criteria').set(admin.h).send({ name: '  Novelty  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Novelty',
      description: null,
      maxScore: 10,
      weight: 1,
      position: 0,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(typeof res.body.weight).toBe('number');
    const row = await prisma.evaluationCriterion.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.createdById).toBe(admin.user.id);
  });

  it('accepts explicit values and boundary values', async () => {
    const admin = await as('ADMINISTRATOR');
    const res = await api()
      .post('/criteria')
      .set(admin.h)
      .send({ name: 'Impact', description: 'Societal impact', maxScore: 100, weight: 99.99, position: 5, isActive: false });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ maxScore: 100, weight: 99.99, position: 5, isActive: false, description: 'Societal impact' });
    expect((await api().post('/criteria').set(admin.h).send({ name: 'Min', maxScore: 1, weight: 0.01 })).status).toBe(201);
  });

  it.each([
    ['empty name', { name: '   ' }],
    ['no name', {}],
    ['maxScore 0', { name: 'x', maxScore: 0 }],
    ['maxScore 101', { name: 'x', maxScore: 101 }],
    ['maxScore non-integer', { name: 'x', maxScore: 7.5 }],
    ['weight 0', { name: 'x', weight: 0 }],
    ['weight 0.009', { name: 'x', weight: 0.009 }],
    ['weight 100', { name: 'x', weight: 100 }],
    ['weight 3 decimals', { name: 'x', weight: 1.234 }],
    ['negative position', { name: 'x', position: -1 }],
    ['string maxScore', { name: 'x', maxScore: '10' }],
    ['unknown key', { name: 'x', createdById: randomUUID() }],
  ])('rejects %s with 400 and creates nothing', async (_label, body) => {
    const admin = await as('ADMINISTRATOR');
    const res = await api().post('/criteria').set(admin.h).send(body);
    expect(res.status).toBe(400);
    expect(await prisma.evaluationCriterion.count()).toBe(0);
  });
});

describe('PUT /criteria/:id (no hard delete)', () => {
  it('updates fields, including deactivation and reactivation', async () => {
    const admin = await as('ADMINISTRATOR');
    const c = await mkCriterion('Novelty', 1);
    const res = await api().put(`/criteria/${c.id}`).set(admin.h).send({ name: 'Originality', weight: 2.5, maxScore: 20, description: 'd' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: c.id, name: 'Originality', weight: 2.5, maxScore: 20, description: 'd', isActive: true });

    const off = await api().put(`/criteria/${c.id}`).set(admin.h).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect(await prisma.evaluationCriterion.count()).toBe(1); // deactivated, not deleted
    const on = await api().put(`/criteria/${c.id}`).set(admin.h).send({ isActive: true });
    expect(on.body.isActive).toBe(true);

    const cleared = await api().put(`/criteria/${c.id}`).set(admin.h).send({ description: null });
    expect(cleared.body.description).toBeNull();
  });

  it('validates input and ids', async () => {
    const admin = await as('ADMINISTRATOR');
    const c = await mkCriterion('Novelty', 1);
    const put = (id: string, body: object) => api().put(`/criteria/${id}`).set(admin.h).send(body);
    expect((await put(c.id, {})).status).toBe(400);
    expect((await put(c.id, { maxScore: 0 })).status).toBe(400);
    expect((await put(c.id, { weight: 100 })).status).toBe(400);
    expect((await put(c.id, { createdById: admin.user.id })).status).toBe(400);
    expect((await put(randomUUID(), { name: 'x' })).status).toBe(404);
    expect((await put('nope', { name: 'x' })).status).toBe(400);
    expect((await prisma.evaluationCriterion.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Novelty');
  });

  it('there is no DELETE route', async () => {
    const admin = await as('ADMINISTRATOR');
    const c = await mkCriterion('Novelty', 1);
    expect((await api().delete(`/criteria/${c.id}`).set(admin.h)).status).toBe(404);
    expect(await prisma.evaluationCriterion.count()).toBe(1);
  });
});

describe('GET /criteria', () => {
  it('returns active criteria ordered by position; includeInactive only for administrators', async () => {
    await mkCriterion('C', 3);
    await mkCriterion('A', 1);
    await mkCriterion('Hidden', 2, { isActive: false });
    await mkCriterion('B', 2);
    const admin = await as('ADMINISTRATOR');
    const judge = await as('JUDGE');

    const active = await api().get('/criteria').set(admin.h);
    expect(active.status).toBe(200);
    expect(names(active.body)).toEqual(['A', 'B', 'C']);

    const all = await api().get('/criteria?includeInactive=true').set(admin.h);
    expect(names(all.body)).toEqual(['A', 'Hidden', 'B', 'C']);

    expect(names((await api().get('/criteria').set(judge.h)).body)).toEqual(['A', 'B', 'C']);
    // The flag is ignored for judges: they never see deactivated criteria.
    expect(names((await api().get('/criteria?includeInactive=true').set(judge.h)).body)).toEqual(['A', 'B', 'C']);

    expect((await api().get('/criteria?includeInactive=maybe').set(admin.h)).status).toBe(400);
  });

  it('ties on position fall back to creation order', async () => {
    await mkCriterion('first', 1);
    await mkCriterion('second', 1);
    const admin = await as('ADMINISTRATOR');
    expect(names((await api().get('/criteria').set(admin.h)).body)).toEqual(['first', 'second']);
  });
});

describe('GET /projects/:id/rubric', () => {
  async function seed() {
    await mkCriterion('Second', 2);
    await mkCriterion('First', 1);
    await mkCriterion('Retired', 0, { isActive: false });
    const admin = await as('ADMINISTRATOR');
    const owner = await as('RESEARCHER');
    const project = await prisma.project.create({ data: { ownerId: owner.user.id, title: 'P', status: 'SUBMITTED' } });
    return { admin, owner, project };
  }
  const rubric = (a: Actor, id: string) => api().get(`/projects/${id}/rubric`).set(a.h);

  it('returns the ordered ACTIVE criteria to the team, an administrator and the assigned judge', async () => {
    const { admin, owner, project } = await seed();
    const member = await as('STUDENT');
    const judge = await as('JUDGE');
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: member.user.id } });
    await prisma.judgeAssignment.create({ data: { projectId: project.id, judgeId: judge.user.id, assignedById: admin.user.id } });

    for (const a of [admin, owner, member, judge]) {
      const res = await rubric(a, project.id);
      expect(res.status).toBe(200);
      expect(res.body.projectId).toBe(project.id);
      expect(names(res.body)).toEqual(['First', 'Second']);
    }
  });

  it('is invisible (404) to non-members and unassigned judges, and 403 for investors even if linked', async () => {
    const { admin, project } = await seed();
    const outsider = await as('RESEARCHER');
    const student = await as('STUDENT');
    const judge = await as('JUDGE');
    const investor = await as('INVESTOR');
    await prisma.investorProjectLink.create({ data: { projectId: project.id, investorId: investor.user.id, linkedById: admin.user.id } });
    expect((await rubric(outsider, project.id)).status).toBe(404);
    expect((await rubric(student, project.id)).status).toBe(404);
    expect((await rubric(judge, project.id)).status).toBe(404);
    expect((await rubric(investor, project.id)).status).toBe(403);
    expect((await rubric(admin, randomUUID())).status).toBe(404);
    expect((await rubric(admin, 'nope')).status).toBe(400);
  });

  it('reflects criteria changes immediately', async () => {
    const { admin, project } = await seed();
    const created = await api().post('/criteria').set(admin.h).send({ name: 'Zeroth', position: 0 });
    expect(names((await rubric(admin, project.id)).body)).toEqual(['Zeroth', 'First', 'Second']);
    await api().put(`/criteria/${created.body.id}`).set(admin.h).send({ isActive: false });
    expect(names((await rubric(admin, project.id)).body)).toEqual(['First', 'Second']);
  });
});
