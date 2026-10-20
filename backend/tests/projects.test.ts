import type { ProjectStatus, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { allowedNextStatuses, TRANSITIONS } from '../src/projects/projects.lifecycle';
import { api, bearer, loginAs, makeUser, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const ALL_STATUSES: ProjectStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_EVALUATION', 'EVALUATED', 'ARCHIVED'];

async function as(role: Role, overrides: Parameters<typeof makeUser>[1] = {}) {
  const user = await makeUser(role, overrides);
  const { token } = await loginAs(user.email);
  return { user, token, h: bearer(token) };
}
type Actor = Awaited<ReturnType<typeof as>>;

function mkProject(ownerId: string, over: Partial<{ title: string; description: string | null; status: ProjectStatus }> = {}) {
  return prisma.project.create({
    data: {
      ownerId,
      title: over.title ?? 'Quantum sensing',
      description: over.description === undefined ? 'A complete description' : over.description,
      status: over.status ?? 'DRAFT',
    },
  });
}

const setStatus = (id: string, status: ProjectStatus) => prisma.project.update({ where: { id }, data: { status } });
const putStatus = (a: Actor, id: string, status: unknown) =>
  api().put(`/projects/${id}/status`).set(a.h).send({ status });

describe('authentication on every project endpoint', () => {
  it('returns 401 without a token', async () => {
    const id = randomUUID();
    const calls = [
      api().post('/projects').send({ title: 'x' }),
      api().get('/projects'),
      api().get(`/projects/${id}`),
      api().put(`/projects/${id}`).send({ title: 'x' }),
      api().put(`/projects/${id}/status`).send({ status: 'SUBMITTED' }),
      api().get(`/projects/${id}/collaborators`),
      api().post(`/projects/${id}/collaborators`).send({ userId: id }),
      api().delete(`/projects/${id}/collaborators/${id}`),
    ];
    for (const call of calls) expect((await call).status).toBe(401);
  });

  it('returns 401 for a garbage token', async () => {
    const res = await api().get('/projects').set(bearer('not-a-jwt'));
    expect(res.status).toBe(401);
  });
});

describe('POST /projects', () => {
  it('lets RESEARCHER and ADMINISTRATOR create; owner = caller, affiliation defaults from creator', async () => {
    const researcher = await as('RESEARCHER');
    await prisma.user.update({ where: { id: researcher.user.id }, data: { affiliation: 'UniPoli' } });
    const res = await api().post('/projects').set(researcher.h).send({ title: '  My project  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ownerId: researcher.user.id,
      title: 'My project',
      status: 'DRAFT',
      affiliation: 'UniPoli',
      submittedAt: null,
    });

    const admin = await as('ADMINISTRATOR');
    const res2 = await api().post('/projects').set(admin.h).send({ title: 'Admin project', affiliation: 'Elsewhere' });
    expect(res2.status).toBe(201);
    expect(res2.body).toMatchObject({ ownerId: admin.user.id, affiliation: 'Elsewhere' });
  });

  it.each(['STUDENT', 'JUDGE', 'INVESTOR'] as const)('forbids %s (403) and creates nothing', async (role) => {
    const a = await as(role);
    const res = await api().post('/projects').set(a.h).send({ title: 'Nope' });
    expect(res.status).toBe(403);
    expect(await prisma.project.count()).toBe(0);
  });

  it('validates input and never trusts ownerId / status from the body', async () => {
    const r = await as('RESEARCHER');
    const other = await makeUser('RESEARCHER');
    const bad = [
      {},
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(301) },
      { title: 5 },
      { title: 'ok', ownerId: other.id },
      { title: 'ok', status: 'EVALUATED' },
      { title: 'ok', submittedAt: new Date().toISOString() },
    ];
    for (const body of bad) {
      expect((await api().post('/projects').set(r.h).send(body)).status).toBe(400);
    }
    expect(await prisma.project.count()).toBe(0);
  });
});

describe('read scoping (enforced in the database query)', () => {
  async function world() {
    const admin = await as('ADMINISTRATOR');
    const owner = await as('RESEARCHER');
    const collab = await as('RESEARCHER');
    const student = await as('STUDENT');
    const stranger = await as('RESEARCHER');
    const strangerStudent = await as('STUDENT');
    const judge = await as('JUDGE');
    const judgeNoAssignment = await as('JUDGE');
    const investor = await as('INVESTOR');
    const investorNoLink = await as('INVESTOR');

    const p1 = await mkProject(owner.user.id, { title: 'P1 owned+shared', status: 'SUBMITTED' });
    const p2 = await mkProject(owner.user.id, { title: 'P2 owned only' });
    const p3 = await mkProject(stranger.user.id, { title: 'P3 stranger' });

    await prisma.projectCollaborator.create({ data: { projectId: p1.id, userId: collab.user.id, role: 'MEMBER' } });
    await prisma.projectCollaborator.create({ data: { projectId: p1.id, userId: student.user.id, role: 'MEMBER' } });
    await prisma.judgeAssignment.create({
      data: { projectId: p1.id, judgeId: judge.user.id, assignedById: admin.user.id },
    });
    await prisma.investorProjectLink.create({
      data: { projectId: p1.id, investorId: investor.user.id, linkedById: admin.user.id },
    });
    return { admin, owner, collab, student, stranger, strangerStudent, judge, judgeNoAssignment, investor, investorNoLink, p1, p2, p3 };
  }

  const titles = (res: { body: { data: { title: string }[] } }) => res.body.data.map((p) => p.title).sort();

  it('ADMINISTRATOR sees everything', async () => {
    const w = await world();
    const res = await api().get('/projects').set(w.admin.h);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(titles(res)).toEqual(['P1 owned+shared', 'P2 owned only', 'P3 stranger']);
  });

  it('RESEARCHER: owner sees owned, collaborator sees shared, stranger sees only theirs', async () => {
    const w = await world();
    expect(titles(await api().get('/projects').set(w.owner.h))).toEqual(['P1 owned+shared', 'P2 owned only']);
    expect(titles(await api().get('/projects').set(w.collab.h))).toEqual(['P1 owned+shared']);
    expect(titles(await api().get('/projects').set(w.stranger.h))).toEqual(['P3 stranger']);
  });

  it('STUDENT sees only projects they collaborate on', async () => {
    const w = await world();
    expect(titles(await api().get('/projects').set(w.student.h))).toEqual(['P1 owned+shared']);
    const none = await api().get('/projects').set(w.strangerStudent.h);
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ data: [], total: 0 });
  });

  it('JUDGE sees only assigned projects (none without an assignment)', async () => {
    const w = await world();
    expect(titles(await api().get('/projects').set(w.judge.h))).toEqual(['P1 owned+shared']);
    expect((await api().get('/projects').set(w.judgeNoAssignment.h)).body.total).toBe(0);
  });

  it('INVESTOR sees only linked projects (none without a link)', async () => {
    const w = await world();
    expect(titles(await api().get('/projects').set(w.investor.h))).toEqual(['P1 owned+shared']);
    expect((await api().get('/projects').set(w.investorNoLink.h)).body.total).toBe(0);
  });

  it('scoping follows the data: removing the link/assignment/collaboration revokes access', async () => {
    const w = await world();
    await prisma.investorProjectLink.deleteMany({});
    await prisma.judgeAssignment.deleteMany({});
    await prisma.projectCollaborator.deleteMany({});
    expect((await api().get('/projects').set(w.investor.h)).body.total).toBe(0);
    expect((await api().get('/projects').set(w.judge.h)).body.total).toBe(0);
    expect((await api().get('/projects').set(w.collab.h)).body.total).toBe(0);
    expect((await api().get(`/projects/${w.p1.id}`).set(w.investor.h)).status).toBe(404);
  });

  it('GET /projects/:id returns 200 when visible and 404 (not 403) when not', async () => {
    const w = await world();
    for (const a of [w.admin, w.owner, w.collab, w.student, w.judge, w.investor]) {
      const res = await api().get(`/projects/${w.p1.id}`).set(a.h);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: w.p1.id, status: 'SUBMITTED', allowedNextStatuses: ['DRAFT', 'UNDER_EVALUATION'] });
    }
    for (const a of [w.stranger, w.strangerStudent, w.judgeNoAssignment, w.investorNoLink]) {
      expect((await api().get(`/projects/${w.p1.id}`).set(a.h)).status).toBe(404);
    }
    // P2 is owned only: not visible to its own project's collaborator of P1, judge or investor.
    for (const a of [w.collab, w.student, w.judge, w.investor]) {
      expect((await api().get(`/projects/${w.p2.id}`).set(a.h)).status).toBe(404);
    }
    // Same body as a project that does not exist: existence is not leaked.
    const missing = await api().get(`/projects/${randomUUID()}`).set(w.stranger.h);
    const hidden = await api().get(`/projects/${w.p1.id}`).set(w.stranger.h);
    expect(missing.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it('GET /projects/:id with a malformed id is 400', async () => {
    const a = await as('ADMINISTRATOR');
    expect((await api().get('/projects/not-a-uuid').set(a.h)).status).toBe(400);
  });

  it('supports status filter, limit cap and offset pagination', async () => {
    const admin = await as('ADMINISTRATOR');
    const r = await as('RESEARCHER');
    for (let i = 0; i < 5; i++) await mkProject(r.user.id, { title: `D${i}` });
    await mkProject(r.user.id, { title: 'S0', status: 'SUBMITTED' });

    const sub = await api().get('/projects?status=SUBMITTED').set(admin.h);
    expect(sub.body).toMatchObject({ total: 1 });
    expect(sub.body.data[0].title).toBe('S0');

    const page1 = await api().get('/projects?limit=4&offset=0').set(admin.h);
    const page2 = await api().get('/projects?limit=4&offset=4').set(admin.h);
    expect(page1.body).toMatchObject({ total: 6, limit: 4, offset: 0 });
    expect(page1.body.data).toHaveLength(4);
    expect(page2.body.data).toHaveLength(2);
    const ids = [...page1.body.data, ...page2.body.data].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(6);

    const capped = await api().get('/projects?limit=100000').set(admin.h);
    expect(capped.status).toBe(200);
    expect(capped.body.limit).toBe(100);

    // Filter is combined with (not replacing) scoping.
    const other = await as('RESEARCHER');
    expect((await api().get('/projects?status=SUBMITTED').set(other.h)).body.total).toBe(0);

    for (const q of ['status=BOGUS', 'limit=0', 'limit=abc', 'offset=-1']) {
      expect((await api().get(`/projects?${q}`).set(admin.h)).status).toBe(400);
    }
  });
});

describe('PUT /projects/:id', () => {
  it('owner edits a DRAFT; unspecified fields are untouched', async () => {
    const owner = await as('RESEARCHER');
    const p = await mkProject(owner.user.id);
    const res = await api().put(`/projects/${p.id}`).set(owner.h).send({ title: 'Renamed', summary: 'S' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Renamed', summary: 'S', description: 'A complete description' });
    const cleared = await api().put(`/projects/${p.id}`).set(owner.h).send({ summary: null });
    expect(cleared.body.summary).toBeNull();
  });

  it('a LEAD collaborator may edit; a MEMBER may not (403); a stranger gets 404', async () => {
    const owner = await as('RESEARCHER');
    const lead = await as('STUDENT');
    const member = await as('RESEARCHER');
    const stranger = await as('RESEARCHER');
    const p = await mkProject(owner.user.id);
    await prisma.projectCollaborator.create({ data: { projectId: p.id, userId: lead.user.id, role: 'LEAD' } });
    await prisma.projectCollaborator.create({ data: { projectId: p.id, userId: member.user.id, role: 'MEMBER' } });

    expect((await api().put(`/projects/${p.id}`).set(lead.h).send({ title: 'By lead' })).status).toBe(200);
    expect((await api().put(`/projects/${p.id}`).set(member.h).send({ title: 'By member' })).status).toBe(403);
    expect((await api().put(`/projects/${p.id}`).set(stranger.h).send({ title: 'By stranger' })).status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).title).toBe('By lead');
  });

  it('JUDGE and INVESTOR are rejected by role (403) even for their visible project', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const judge = await as('JUDGE');
    const investor = await as('INVESTOR');
    const p = await mkProject(owner.user.id, { status: 'SUBMITTED' });
    await prisma.judgeAssignment.create({ data: { projectId: p.id, judgeId: judge.user.id, assignedById: admin.user.id } });
    await prisma.investorProjectLink.create({ data: { projectId: p.id, investorId: investor.user.id, linkedById: admin.user.id } });
    for (const a of [judge, investor]) {
      expect((await api().put(`/projects/${p.id}`).set(a.h).send({ title: 'x' })).status).toBe(403);
      expect((await putStatus(a, p.id, 'DRAFT')).status).toBe(403);
    }
  });

  it('is blocked (409) once the project leaves DRAFT, for owner and lead; ADMINISTRATOR may still edit', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    for (const status of ALL_STATUSES.filter((s) => s !== 'DRAFT')) {
      const p = await mkProject(owner.user.id, { status });
      const res = await api().put(`/projects/${p.id}`).set(owner.h).send({ title: 'late edit' });
      expect(res.status).toBe(409);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).title).toBe('Quantum sensing');
      const adminRes = await api().put(`/projects/${p.id}`).set(admin.h).send({ title: 'admin edit' });
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.status).toBe(status); // editing never changes the status
    }
  });

  it('validates input; ownerId / status / unknown keys are rejected', async () => {
    const owner = await as('RESEARCHER');
    const other = await makeUser('RESEARCHER');
    const p = await mkProject(owner.user.id);
    const bad = [{}, { title: '' }, { title: null }, { ownerId: other.id }, { status: 'EVALUATED' }, { foo: 'bar' }, { title: 'x'.repeat(301) }];
    for (const body of bad) expect((await api().put(`/projects/${p.id}`).set(owner.h).send(body)).status).toBe(400);
    const row = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ ownerId: owner.user.id, status: 'DRAFT', title: 'Quantum sensing' });
  });

  it('404 for a non-existent project', async () => {
    const owner = await as('RESEARCHER');
    expect((await api().put(`/projects/${randomUUID()}`).set(owner.h).send({ title: 'x' })).status).toBe(404);
  });
});

describe('PUT /projects/:id/status (lifecycle)', () => {
  it('exposes exactly the documented transition table', () => {
    expect(TRANSITIONS.map((t) => `${t.from}>${t.to}:${t.actor}`)).toEqual([
      'DRAFT>SUBMITTED:MANAGER',
      'SUBMITTED>DRAFT:MANAGER',
      'SUBMITTED>UNDER_EVALUATION:ADMIN',
      'UNDER_EVALUATION>EVALUATED:ADMIN',
      'EVALUATED>ARCHIVED:ADMIN',
    ]);
    expect(allowedNextStatuses('ARCHIVED')).toEqual([]);
  });

  it('walks the whole happy path, setting and clearing submittedAt', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const p = await mkProject(owner.user.id);

    const submitted = await putStatus(owner, p.id, 'SUBMITTED');
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.submittedAt).not.toBeNull();

    const withdrawn = await putStatus(owner, p.id, 'DRAFT');
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body).toMatchObject({ status: 'DRAFT', submittedAt: null });
    expect((await api().put(`/projects/${p.id}`).set(owner.h).send({ title: 'editable again' })).status).toBe(200);

    expect((await putStatus(owner, p.id, 'SUBMITTED')).status).toBe(200);
    for (const next of ['UNDER_EVALUATION', 'EVALUATED', 'ARCHIVED'] as const) {
      const res = await putStatus(admin, p.id, next);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(next);
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('ARCHIVED');
  });

  it('an administrator may also submit/withdraw (MANAGER transitions)', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const p = await mkProject(owner.user.id);
    expect((await putStatus(admin, p.id, 'SUBMITTED')).status).toBe(200);
    expect((await putStatus(admin, p.id, 'DRAFT')).status).toBe(200);
  });

  it('rejects EVERY transition that is not in the table with 409 and leaves the status unchanged', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const valid = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}`));
    let rejected = 0;
    for (const from of ALL_STATUSES) {
      const p = await mkProject(owner.user.id, { status: from });
      for (const to of ALL_STATUSES) {
        if (valid.has(`${from}>${to}`)) continue;
        for (const actor of [owner, admin]) {
          const res = await putStatus(actor, p.id, to);
          expect(res.status, `${from} -> ${to} as ${actor.user.role}`).toBe(409);
          expect(res.body.error).toMatch(/Invalid status transition/);
          rejected++;
        }
      }
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(from);
    }
    expect(rejected).toBe((25 - 5) * 2);
  });

  it('the owner cannot perform administrator-only transitions (403)', async () => {
    const owner = await as('RESEARCHER');
    const steps: [ProjectStatus, ProjectStatus][] = [
      ['SUBMITTED', 'UNDER_EVALUATION'],
      ['UNDER_EVALUATION', 'EVALUATED'],
      ['EVALUATED', 'ARCHIVED'],
    ];
    for (const [from, to] of steps) {
      const p = await mkProject(owner.user.id, { status: from });
      expect((await putStatus(owner, p.id, to)).status).toBe(403);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(from);
    }
  });

  it('a non-owner cannot submit: stranger 404, MEMBER 403, STUDENT-role 403 by membership; LEAD can', async () => {
    const owner = await as('RESEARCHER');
    const stranger = await as('RESEARCHER');
    const member = await as('RESEARCHER');
    const student = await as('STUDENT');
    const strangerStudent = await as('STUDENT');
    const lead = await as('STUDENT');
    const p = await mkProject(owner.user.id);
    await prisma.projectCollaborator.createMany({
      data: [
        { projectId: p.id, userId: member.user.id, role: 'MEMBER' },
        { projectId: p.id, userId: student.user.id, role: 'MEMBER' },
        { projectId: p.id, userId: lead.user.id, role: 'LEAD' },
      ],
    });
    expect((await putStatus(stranger, p.id, 'SUBMITTED')).status).toBe(404);
    expect((await putStatus(strangerStudent, p.id, 'SUBMITTED')).status).toBe(404);
    expect((await putStatus(member, p.id, 'SUBMITTED')).status).toBe(403);
    expect((await putStatus(student, p.id, 'SUBMITTED')).status).toBe(403);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('DRAFT');
    expect((await putStatus(lead, p.id, 'SUBMITTED')).status).toBe(200);
  });

  it('requires title and description before DRAFT -> SUBMITTED (422)', async () => {
    const owner = await as('RESEARCHER');
    const noDesc = await mkProject(owner.user.id, { description: null });
    const blankDesc = await mkProject(owner.user.id, { description: '   ' });
    for (const p of [noDesc, blankDesc]) {
      const res = await putStatus(owner, p.id, 'SUBMITTED');
      expect(res.status).toBe(422);
      expect(res.body.missing).toEqual(['description']);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('DRAFT');
    }
    await api().put(`/projects/${noDesc.id}`).set(owner.h).send({ description: 'Now complete' });
    expect((await putStatus(owner, noDesc.id, 'SUBMITTED')).status).toBe(200);
  });

  it('validates the body (400) and hides invisible projects (404)', async () => {
    const owner = await as('RESEARCHER');
    const stranger = await as('RESEARCHER');
    const p = await mkProject(owner.user.id);
    for (const body of [{}, { status: 'submitted' }, { status: 'DONE' }, { status: 5 }, { status: 'SUBMITTED', ownerId: stranger.user.id }]) {
      expect((await api().put(`/projects/${p.id}/status`).set(owner.h).send(body)).status).toBe(400);
    }
    expect((await putStatus(owner, randomUUID(), 'SUBMITTED')).status).toBe(404);
    expect((await putStatus(stranger, p.id, 'SUBMITTED')).status).toBe(404);
  });

  it('two concurrent identical transitions: exactly one wins', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const p = await mkProject(owner.user.id, { status: 'SUBMITTED' });
    const results = await Promise.all([putStatus(admin, p.id, 'UNDER_EVALUATION'), putStatus(admin, p.id, 'UNDER_EVALUATION')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('collaborators', () => {
  it('owner adds RESEARCHER and STUDENT collaborators; list includes the implicit LEAD owner', async () => {
    const owner = await as('RESEARCHER');
    const colleague = await as('RESEARCHER');
    const student = await as('STUDENT');
    const p = await mkProject(owner.user.id);

    const r1 = await api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ userId: colleague.user.id, role: 'LEAD' });
    expect(r1.status).toBe(201);
    const r2 = await api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ userId: student.user.id });
    expect(r2.status).toBe(201);

    const list = await api().get(`/projects/${p.id}/collaborators`).set(owner.h);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data[0]).toMatchObject({ userId: owner.user.id, role: 'LEAD', isOwner: true });
    expect(list.body.data.find((c: { userId: string }) => c.userId === student.user.id)).toMatchObject({ role: 'MEMBER', isOwner: false });
    expect(JSON.stringify(list.body)).not.toMatch(/password/i);

    // Collaborators can read the list too.
    expect((await api().get(`/projects/${p.id}/collaborators`).set(student.h)).status).toBe(200);
  });

  it('only RESEARCHER/STUDENT users can be collaborators (422); owner 409; duplicate 409; unknown/inactive 404', async () => {
    const owner = await as('RESEARCHER');
    const p = await mkProject(owner.user.id);
    const add = (userId: string) => api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ userId });

    for (const role of ['JUDGE', 'INVESTOR', 'ADMINISTRATOR'] as const) {
      expect((await add((await makeUser(role)).id)).status).toBe(422);
    }
    expect((await add(owner.user.id)).status).toBe(409);
    const ok = await makeUser('STUDENT');
    expect((await add(ok.id)).status).toBe(201);
    expect((await add(ok.id)).status).toBe(409);
    expect((await add(randomUUID())).status).toBe(404);
    const inactive = await makeUser('STUDENT', { isActive: false });
    expect((await add(inactive.id)).status).toBe(404);
    expect(await prisma.projectCollaborator.count({ where: { projectId: p.id } })).toBe(1);
  });

  describe('adding by email', () => {
    it('adds an eligible user by email (case-insensitive) and returns the updated list', async () => {
      const owner = await as('RESEARCHER');
      // The API always stores emails lowercased; the request may use any case / surrounding spaces.
      const student = await makeUser('STUDENT', { email: 'ana.student@test.local' });
      const p = await mkProject(owner.user.id);
      const res = await api()
        .post(`/projects/${p.id}/collaborators`)
        .set(owner.h)
        .send({ email: '  ANA.student@test.LOCAL ', role: 'LEAD' });
      expect(res.status).toBe(201);
      const added = res.body.data.find((c: { userId: string }) => c.userId === student.id);
      expect(added).toMatchObject({ role: 'LEAD', isOwner: false });
      expect(await prisma.projectCollaborator.count({ where: { projectId: p.id } })).toBe(1);
    });

    it('answers unknown, inactive and non-collaborator-role emails identically (404, no enumeration)', async () => {
      const owner = await as('RESEARCHER');
      const p = await mkProject(owner.user.id);
      const judge = await makeUser('JUDGE');
      const inactive = await makeUser('STUDENT', { isActive: false });
      const admin = await makeUser('ADMINISTRATOR');
      const bodies = [judge.email, inactive.email, admin.email, 'nobody@test.local'].map((email) =>
        api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ email }),
      );
      const results = await Promise.all(bodies);
      for (const r of results) expect(r.status).toBe(404);
      expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
      expect(await prisma.projectCollaborator.count({ where: { projectId: p.id } })).toBe(0);
    });

    it('rejects the owner (409) and duplicates (409) by email too', async () => {
      const owner = await as('RESEARCHER');
      const s = await makeUser('STUDENT');
      const p = await mkProject(owner.user.id);
      const add = (email: string) => api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ email });
      expect((await add(owner.user.email)).status).toBe(409);
      expect((await add(s.email)).status).toBe(201);
      expect((await add(s.email)).status).toBe(409);
    });

    it('requires exactly one of userId / email, and a valid email (400)', async () => {
      const owner = await as('RESEARCHER');
      const s = await makeUser('STUDENT');
      const p = await mkProject(owner.user.id);
      for (const body of [{ userId: s.id, email: s.email }, { email: 'not-an-email' }, { email: '' }]) {
        expect((await api().post(`/projects/${p.id}/collaborators`).set(owner.h).send(body)).status).toBe(400);
      }
    });

    it('keeps the existing permission rules: a plain collaborator or stranger cannot add by email', async () => {
      const owner = await as('RESEARCHER');
      const member = await as('STUDENT');
      const stranger = await as('RESEARCHER');
      const target = await makeUser('STUDENT');
      const p = await mkProject(owner.user.id);
      await api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ userId: member.user.id });
      const byMember = await api().post(`/projects/${p.id}/collaborators`).set(member.h).send({ email: target.email });
      expect(byMember.status).toBe(403);
      const byStranger = await api().post(`/projects/${p.id}/collaborators`).set(stranger.h).send({ email: target.email });
      expect(byStranger.status).toBe(404);
    });
  });

  it('validates the body (400)', async () => {
    const owner = await as('RESEARCHER');
    const s = await makeUser('STUDENT');
    const p = await mkProject(owner.user.id);
    for (const body of [{}, { userId: 'nope' }, { userId: s.id, role: 'BOSS' }, { userId: s.id, projectId: randomUUID() }]) {
      expect((await api().post(`/projects/${p.id}/collaborators`).set(owner.h).send(body)).status).toBe(400);
    }
  });

  it('RBAC: MEMBER 403, LEAD ok, stranger 404, JUDGE/INVESTOR 403, ADMINISTRATOR ok', async () => {
    const owner = await as('RESEARCHER');
    const member = await as('STUDENT');
    const lead = await as('RESEARCHER');
    const stranger = await as('RESEARCHER');
    const judge = await as('JUDGE');
    const investor = await as('INVESTOR');
    const admin = await as('ADMINISTRATOR');
    const target = await makeUser('STUDENT');
    const target2 = await makeUser('STUDENT');
    const p = await mkProject(owner.user.id);
    await prisma.projectCollaborator.createMany({
      data: [
        { projectId: p.id, userId: member.user.id, role: 'MEMBER' },
        { projectId: p.id, userId: lead.user.id, role: 'LEAD' },
      ],
    });
    await prisma.judgeAssignment.create({ data: { projectId: p.id, judgeId: judge.user.id, assignedById: admin.user.id } });
    await prisma.investorProjectLink.create({ data: { projectId: p.id, investorId: investor.user.id, linkedById: admin.user.id } });

    const post = (a: Actor, userId: string) => api().post(`/projects/${p.id}/collaborators`).set(a.h).send({ userId });
    expect((await post(member, target.id)).status).toBe(403);
    expect((await post(stranger, target.id)).status).toBe(404);
    expect((await post(judge, target.id)).status).toBe(403);
    expect((await post(investor, target.id)).status).toBe(403);
    expect(await prisma.projectCollaborator.count({ where: { projectId: p.id, userId: target.id } })).toBe(0);
    expect((await post(lead, target.id)).status).toBe(201);
    expect((await post(admin, target2.id)).status).toBe(201);

    // GET list: judges and investors are outside the project team; strangers can't see it.
    const get = (a: Actor) => api().get(`/projects/${p.id}/collaborators`).set(a.h);
    expect((await get(judge)).status).toBe(403);
    expect((await get(investor)).status).toBe(403);
    expect((await get(stranger)).status).toBe(404);
    expect((await get(admin)).status).toBe(200);

    // DELETE
    const del = (a: Actor, userId: string) => api().delete(`/projects/${p.id}/collaborators/${userId}`).set(a.h);
    expect((await del(member, target.id)).status).toBe(403);
    expect((await del(stranger, target.id)).status).toBe(404);
    expect((await del(judge, target.id)).status).toBe(403);
    expect((await del(investor, target.id)).status).toBe(403);
    expect((await del(lead, target.id)).status).toBe(204);
    expect((await del(admin, target2.id)).status).toBe(204);
  });

  it('removal works, revokes the collaborator\'s read access, and the owner cannot be removed', async () => {
    const owner = await as('RESEARCHER');
    const student = await as('STUDENT');
    const p = await mkProject(owner.user.id);
    await api().post(`/projects/${p.id}/collaborators`).set(owner.h).send({ userId: student.user.id });
    expect((await api().get(`/projects/${p.id}`).set(student.h)).status).toBe(200);

    expect((await api().delete(`/projects/${p.id}/collaborators/${student.user.id}`).set(owner.h)).status).toBe(204);
    expect((await api().get(`/projects/${p.id}`).set(student.h)).status).toBe(404);
    expect((await api().delete(`/projects/${p.id}/collaborators/${student.user.id}`).set(owner.h)).status).toBe(404);
    expect((await api().delete(`/projects/${p.id}/collaborators/${owner.user.id}`).set(owner.h)).status).toBe(409);
    expect((await api().delete(`/projects/${p.id}/collaborators/not-a-uuid`).set(owner.h)).status).toBe(400);
  });

  it('a project is not touched via another project\'s collaborator route', async () => {
    const owner = await as('RESEARCHER');
    const other = await as('RESEARCHER');
    const student = await makeUser('STUDENT');
    const mine = await mkProject(owner.user.id);
    const theirs = await mkProject(other.user.id);
    await prisma.projectCollaborator.create({ data: { projectId: theirs.id, userId: student.id, role: 'MEMBER' } });
    // owner tries to remove a collaborator of someone else's project
    expect((await api().delete(`/projects/${theirs.id}/collaborators/${student.id}`).set(owner.h)).status).toBe(404);
    expect((await api().delete(`/projects/${mine.id}/collaborators/${student.id}`).set(owner.h)).status).toBe(404);
    expect(await prisma.projectCollaborator.count({ where: { projectId: theirs.id } })).toBe(1);
  });
});
