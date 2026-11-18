import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { api, bearer, loginAs, makeUser, PASSWORD, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('POST /auth/login', () => {
  it('returns a JWT and the public user on valid credentials', async () => {
    const u = await makeUser('USER');
    const res = await api().post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresInSeconds).toBe(30 * 60);
    expect(res.body.user).toMatchObject({ id: u.id, email: u.email, role: 'USER' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('normalises email case', async () => {
    const u = await makeUser('JUDGE');
    const res = await api().post('/auth/login').send({ email: u.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('gives the same 401 for wrong password and unknown email', async () => {
    const u = await makeUser('USER');
    const wrong = await api().post('/auth/login').send({ email: u.email, password: 'nope-nope-nope' });
    const unknown = await api().post('/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects a deactivated account even with the right password', async () => {
    const u = await makeUser('USER', { isActive: false });
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
    const u = await makeUser('USER');
    const { token } = await loginAs(u.email);
    const res = await api().get('/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(u.id);
    expect((await api().get('/auth/me')).status).toBe(401);
  });
});

describe('POST /auth/register (self-signup)', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    email: 'nuevo@unipolidgo.edu.mx',
    password: 'una-clave-larga-1',
    fullName: 'Nora Nueva',
    ...over,
  });

  it('creates a USER, signs them in, and never returns the password', async () => {
    const res = await api().post('/auth/register').send(body({ affiliation: 'UNIPOLI' }));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'nuevo@unipolidgo.edu.mx', role: 'USER', affiliation: 'UNIPOLI', isOwner: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect((await api().get('/auth/me').set(bearer(res.body.token))).body.role).toBe('USER');
    expect((await api().post('/auth/login').send({ email: 'nuevo@unipolidgo.edu.mx', password: 'una-clave-larga-1' })).status).toBe(200);
  });

  it('cannot be used to obtain a privileged role (the key is rejected, not ignored)', async () => {
    for (const role of ['ADMINISTRATOR', 'JUDGE', 'INVESTOR', 'USER']) {
      expect((await api().post('/auth/register').send(body({ role }))).status).toBe(400);
    }
    expect((await api().post('/auth/register').send(body({ isOwner: true }))).status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects duplicates (409), short passwords and bad emails (400)', async () => {
    expect((await api().post('/auth/register').send(body())).status).toBe(201);
    expect((await api().post('/auth/register').send(body({ email: 'NUEVO@unipolidgo.edu.mx' }))).status).toBe(409);
    expect((await api().post('/auth/register').send(body({ email: 'otro@x.mx', password: 'corta' }))).status).toBe(400);
    expect((await api().post('/auth/register').send(body({ email: 'no-es-correo' }))).status).toBe(400);
    expect((await api().post('/auth/register').send(body({ email: 'b@x.mx', fullName: '   ' }))).status).toBe(400);
  });

  it('can be limited to an institutional domain (CON-001)', async () => {
    env.SIGNUP_EMAIL_DOMAIN = 'unipolidgo.edu.mx';
    try {
      const bad = await api().post('/auth/register').send(body({ email: 'x@gmail.com' }));
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
      expect((await api().post('/auth/register').send(body())).status).toBe(201);
    } finally {
      env.SIGNUP_EMAIL_DOMAIN = undefined;
    }
  });

  it('reviewers (JUDGE / INVESTOR) can only be created by an administrator', async () => {
    const user = await makeUser('USER');
    const admin = await makeUser('ADMINISTRATOR');
    const payload = { email: 'revisor@test.local', password: 'una-clave-larga-1', fullName: 'Rev', role: 'JUDGE' };
    expect((await api().post('/users').send(payload)).status).toBe(401);
    expect((await api().post('/users').set(bearer((await loginAs(user.email)).token)).send(payload)).status).toBe(403);
    const ok = await api().post('/users').set(bearer((await loginAs(admin.email)).token)).send(payload);
    expect(ok.status).toBe(201);
    expect(ok.body.role).toBe('JUDGE');
  });
});
