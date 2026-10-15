import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { api, bearer, loginAs, makeUser, PASSWORD, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function adminToken() {
  const admin = await makeUser('ADMINISTRATOR');
  const { token } = await loginAs(admin.email);
  return { admin, token };
}

describe('POST /users', () => {
  const newUser = { email: 'New.Person@Test.local', password: 'a-strong-password', fullName: 'New Person', role: 'JUDGE' };

  it('lets an administrator create a user (hash stored, never returned)', async () => {
    const { token } = await adminToken();
    const res = await api().post('/users').set(bearer(token)).send(newUser);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'new.person@test.local', role: 'JUDGE', isActive: true, isOwner: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'new.person@test.local' } });
    expect(row.passwordHash).not.toContain('a-strong-password');
    expect(row.passwordHash.startsWith('$2')).toBe(true); // bcrypt
    expect((await loginAs('new.person@test.local', 'a-strong-password')).res.status).toBe(200);
  });

  it('cannot create an owner through the API', async () => {
    const { token } = await adminToken();
    const res = await api().post('/users').set(bearer(token)).send({ ...newUser, isOwner: true });
    expect(res.status).toBe(201);
    expect(res.body.isOwner).toBe(false);
  });

  it('returns 409 for a duplicate email and 400 for invalid input', async () => {
    const { token } = await adminToken();
    expect((await api().post('/users').set(bearer(token)).send(newUser)).status).toBe(201);
    expect((await api().post('/users').set(bearer(token)).send(newUser)).status).toBe(409);
    expect((await api().post('/users').set(bearer(token)).send({ ...newUser, role: 'KING' })).status).toBe(400);
    expect((await api().post('/users').set(bearer(token)).send({ ...newUser, email: 'a@b.co', password: 'short' })).status).toBe(400);
  });

  it('is forbidden for non-administrators', async () => {
    const r = await makeUser('RESEARCHER');
    const { token } = await loginAs(r.email);
    expect((await api().post('/users').set(bearer(token)).send(newUser)).status).toBe(403);
  });
});

describe('PUT /users/:id', () => {
  it('updates profile fields, role and active flag', async () => {
    const { token } = await adminToken();
    const target = await makeUser('STUDENT');
    const res = await api()
      .put(`/users/${target.id}`)
      .set(bearer(token))
      .send({ fullName: 'Renamed', role: 'RESEARCHER', affiliation: 'Unipoli', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fullName: 'Renamed', role: 'RESEARCHER', affiliation: 'Unipoli', isActive: false });
  });

  it('resets the password and clears a lockout', async () => {
    const { token } = await adminToken();
    const target = await makeUser('STUDENT');
    for (let i = 0; i < 5; i++) await api().post('/auth/login').send({ email: target.email, password: 'wrong-wrong-wrong' });
    expect((await loginAs(target.email)).res.status).toBe(423);

    const res = await api().put(`/users/${target.id}`).set(bearer(token)).send({ password: 'brand-new-password' });
    expect(res.status).toBe(200);
    expect((await loginAs(target.email, 'brand-new-password')).res.status).toBe(200);
    expect((await loginAs(target.email)).res.status).toBe(401); // old password no longer works
  });

  it('unlocks an account without changing the password', async () => {
    const { token } = await adminToken();
    const target = await makeUser('STUDENT');
    for (let i = 0; i < 5; i++) await api().post('/auth/login').send({ email: target.email, password: 'wrong-wrong-wrong' });
    expect((await api().put(`/users/${target.id}`).set(bearer(token)).send({ unlockAccount: true })).status).toBe(200);
    expect((await loginAs(target.email)).res.status).toBe(200);
  });

  it('protects the owner from demotion and deactivation', async () => {
    const { token } = await adminToken();
    const owner = await makeUser('ADMINISTRATOR', { isOwner: true });
    expect((await api().put(`/users/${owner.id}`).set(bearer(token)).send({ role: 'STUDENT' })).status).toBe(409);
    expect((await api().put(`/users/${owner.id}`).set(bearer(token)).send({ isActive: false })).status).toBe(409);
    expect((await api().put(`/users/${owner.id}`).set(bearer(token)).send({ fullName: 'Still Fine' })).status).toBe(200);
  });

  it('returns 404 for an unknown id, 400 for a bad id or empty body', async () => {
    const { token } = await adminToken();
    expect((await api().put('/users/00000000-0000-4000-8000-000000000000').set(bearer(token)).send({ fullName: 'x' })).status).toBe(404);
    expect((await api().put('/users/not-a-uuid').set(bearer(token)).send({ fullName: 'x' })).status).toBe(400);
    const target = await makeUser('STUDENT');
    expect((await api().put(`/users/${target.id}`).set(bearer(token)).send({})).status).toBe(400);
  });

  it('is forbidden for non-administrators, even on their own record', async () => {
    const s = await makeUser('STUDENT');
    const { token } = await loginAs(s.email);
    // privilege-escalation attempt
    const res = await api().put(`/users/${s.id}`).set(bearer(token)).send({ role: 'ADMINISTRATOR' });
    expect(res.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).role).toBe('STUDENT');
  });

  it('requires authentication', async () => {
    const s = await makeUser('STUDENT');
    expect((await api().put(`/users/${s.id}`).send({ fullName: 'x' })).status).toBe(401);
  });
});

describe('misc', () => {
  it('health check is public and unknown routes 404', async () => {
    expect((await api().get('/health')).status).toBe(200);
    expect((await api().get('/nope')).status).toBe(404);
  });

  it('PASSWORD constant sanity (used by helpers)', () => {
    expect(PASSWORD.length).toBeGreaterThanOrEqual(10);
  });
});
