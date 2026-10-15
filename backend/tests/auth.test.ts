import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { api, bearer, loginAs, makeUser, PASSWORD, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('POST /auth/login', () => {
  it('returns a JWT and the public user on valid credentials', async () => {
    const u = await makeUser('RESEARCHER');
    const res = await api().post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresInSeconds).toBe(30 * 60);
    expect(res.body.user).toMatchObject({ id: u.id, email: u.email, role: 'RESEARCHER' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('normalises email case', async () => {
    const u = await makeUser('JUDGE');
    const res = await api().post('/auth/login').send({ email: u.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('gives the same 401 for wrong password and unknown email', async () => {
    const u = await makeUser('STUDENT');
    const wrong = await api().post('/auth/login').send({ email: u.email, password: 'nope-nope-nope' });
    const unknown = await api().post('/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects a deactivated account even with the right password', async () => {
    const u = await makeUser('STUDENT', { isActive: false });
    const res = await api().post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects malformed bodies with 400', async () => {
    expect((await api().post('/auth/login').send({})).status).toBe(400);
    expect((await api().post('/auth/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(400);
  });
});

describe('account lockout (NFR-013)', () => {
  const fail = (email: string) => api().post('/auth/login').send({ email, password: 'wrong-wrong-wrong' });

  it('locks the account after 5 failed attempts within 10 minutes', async () => {
    const u = await makeUser('INVESTOR');
    for (let i = 1; i <= 4; i++) expect((await fail(u.email)).status).toBe(401);
    expect((await fail(u.email)).status).toBe(401); // 5th failure triggers the lock

    // Even the CORRECT password is refused while locked.
    const locked = await api().post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('does not lock after only 4 failures, and a success resets the counter', async () => {
    const u = await makeUser('INVESTOR');
    for (let i = 0; i < 4; i++) await fail(u.email);
    expect((await loginAs(u.email)).res.status).toBe(200);
    // counter was reset: 4 more failures still do not lock
    for (let i = 0; i < 4; i++) await fail(u.email);
    expect((await loginAs(u.email)).res.status).toBe(200);
  });

  it('does not lock when failures are spread outside the 10-minute window', async () => {
    const u = await makeUser('INVESTOR');
    for (let i = 0; i < 4; i++) await fail(u.email);
    // Age the first failure beyond the window.
    await prisma.user.update({
      where: { id: u.id },
      data: { firstFailedLoginAt: new Date(Date.now() - (env.LOGIN_FAILURE_WINDOW_MINUTES + 1) * 60_000) },
    });
    expect((await fail(u.email)).status).toBe(401); // restarts the count at 1
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.failedLoginCount).toBe(1);
    expect(after.lockedUntil).toBeNull();
    expect((await loginAs(u.email)).res.status).toBe(200);
  });

  it('unlocks automatically once lockedUntil has passed', async () => {
    const u = await makeUser('INVESTOR');
    for (let i = 0; i < 5; i++) await fail(u.email);
    await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await loginAs(u.email)).res.status).toBe(200);
  });

  it('counts parallel guesses atomically (cannot dodge the lock with concurrency)', async () => {
    const u = await makeUser('INVESTOR');
    await Promise.all(Array.from({ length: 10 }, () => fail(u.email)));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(after.lockedUntil).not.toBeNull();
    expect((await loginAs(u.email)).res.status).toBe(423);
  });
});

describe('POST /auth/bootstrap-owner', () => {
  const body = { email: 'owner@test.local', password: PASSWORD, fullName: 'First Owner' };

  it('creates the first administrator, flagged as owner, who can then log in', async () => {
    const res = await api().post('/auth/bootstrap-owner').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: body.email, role: 'ADMINISTRATOR', isOwner: true });
    expect(res.body.passwordHash).toBeUndefined();
    expect((await loginAs(body.email)).res.status).toBe(200);
  });

  it('is unreachable (404) once an owner exists', async () => {
    expect((await api().post('/auth/bootstrap-owner').send(body)).status).toBe(201);
    const again = await api()
      .post('/auth/bootstrap-owner')
      .send({ ...body, email: 'second@test.local' });
    expect(again.status).toBe(404);
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(1);
  });

  it('only one of several concurrent requests succeeds', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api().post('/auth/bootstrap-owner').send({ ...body, email: `race${i}@test.local` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(1);
  });

  it('requires the bootstrap secret when one is configured', async () => {
    env.BOOTSTRAP_OWNER_SECRET = 'a-long-bootstrap-secret';
    try {
      expect((await api().post('/auth/bootstrap-owner').send(body)).status).toBe(403);
      const wrong = await api().post('/auth/bootstrap-owner').set('x-bootstrap-secret', 'wrong').send(body);
      expect(wrong.status).toBe(403);
      const ok = await api()
        .post('/auth/bootstrap-owner')
        .set('x-bootstrap-secret', 'a-long-bootstrap-secret')
        .send(body);
      expect(ok.status).toBe(201);
    } finally {
      env.BOOTSTRAP_OWNER_SECRET = undefined;
    }
  });

  it('rejects weak passwords', async () => {
    const res = await api().post('/auth/bootstrap-owner').send({ ...body, password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns the caller and requires a token', async () => {
    const u = await makeUser('STUDENT');
    const { token } = await loginAs(u.email);
    const res = await api().get('/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(u.id);
    expect((await api().get('/auth/me')).status).toBe(401);
  });
});
