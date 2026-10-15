import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { errorHandler } from '../src/middleware/errorHandler';
import { authorize } from '../src/middleware/authorize';
import { api, bearer, loginAs, makeUser, resetDb, tokenWithTiming } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

// A protected admin-only route that already exists: POST /users.
const probe = (token?: string) => {
  const r = api().post('/users').send({});
  return token ? r.set(bearer(token)) : r;
};

describe('JWT middleware', () => {
  it('rejects a request with no token', async () => {
    const res = await probe();
    expect(res.status).toBe(401);
  });

  it('rejects garbage and tampered tokens', async () => {
    expect((await probe('not.a.jwt')).status).toBe(401);
    const u = await makeUser('ADMINISTRATOR');
    const forged = jwt.sign({}, 'some-other-secret-some-other-secret-1234', { subject: u.id, expiresIn: 600 });
    expect((await probe(forged)).status).toBe(401);
    const { token } = await loginAs(u.email);
    expect((await probe(token.slice(0, -2) + 'xx')).status).toBe(401);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const u = await makeUser('ADMINISTRATOR');
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    expect((await probe(none)).status).toBe(401);
  });

  it('rejects an expired token (31 minutes of inactivity)', async () => {
    const u = await makeUser('ADMINISTRATOR');
    const expired = tokenWithTiming(u.id, 31 * 60, 30 * 60);
    const res = await api().get('/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
  });

  it('accepts a token that still has time left and slides the window forward', async () => {
    const u = await makeUser('ADMINISTRATOR');
    const almostExpired = tokenWithTiming(u.id, 29 * 60, 30 * 60); // 1 minute left
    const res = await api().get('/auth/me').set(bearer(almostExpired));
    expect(res.status).toBe(200);

    const refreshed = res.headers['x-auth-token'];
    expect(refreshed).toBeDefined();
    const { exp } = jwt.decode(refreshed) as { exp: number };
    const remaining = exp - Math.floor(Date.now() / 1000);
    expect(remaining).toBeGreaterThan(29 * 60); // back to ~30 minutes
    expect(remaining).toBeLessThanOrEqual(env.JWT_INACTIVITY_MINUTES * 60);
    // and the refreshed token works
    expect((await api().get('/auth/me').set(bearer(refreshed))).status).toBe(200);
  });

  it('stops accepting a still-valid token once the user is deactivated', async () => {
    const u = await makeUser('RESEARCHER');
    const { token } = await loginAs(u.email);
    expect((await api().get('/auth/me').set(bearer(token))).status).toBe(200);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await api().get('/auth/me').set(bearer(token))).status).toBe(401);
  });
});

describe('RBAC middleware (FR-030)', () => {
  it.each(['RESEARCHER', 'JUDGE', 'STUDENT', 'INVESTOR'] as const)('forbids %s on an admin-only route', async (role) => {
    const u = await makeUser(role);
    const { token } = await loginAs(u.email);
    const res = await probe(token);
    expect(res.status).toBe(403);
  });

  it('allows an administrator past the role check (reaches validation)', async () => {
    const u = await makeUser('ADMINISTRATOR');
    const { token } = await loginAs(u.email);
    expect((await probe(token)).status).toBe(400); // empty body → validation error, not 401/403
  });

  it('revalidates the role on every request: demotion applies to an already-issued token', async () => {
    const admin = await makeUser('ADMINISTRATOR');
    const { token } = await loginAs(admin.email);
    expect((await probe(token)).status).toBe(400);
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'STUDENT' } });
    expect((await probe(token)).status).toBe(403);
  });

  it('revalidates ownership per request: users can read themselves but not others', async () => {
    const a = await makeUser('STUDENT');
    const b = await makeUser('STUDENT');
    const { token } = await loginAs(a.email);
    expect((await api().get(`/users/${a.id}`).set(bearer(token))).status).toBe(200);
    expect((await api().get(`/users/${b.id}`).set(bearer(token))).status).toBe(403);
  });

  describe('default deny', () => {
    const build = (opts: Parameters<typeof authorize>[0]) => {
      const app = express();
      app.get('/x', ...authorize(opts), (_req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
      return app;
    };

    it('denies when no rule is configured', async () => {
      const u = await makeUser('ADMINISTRATOR');
      const { token } = await loginAs(u.email);
      expect((await request(build({})).get('/x').set(bearer(token))).status).toBe(403);
    });

    it('denies when the ownership predicate throws', async () => {
      const u = await makeUser('STUDENT');
      const { token } = await loginAs(u.email);
      const app = build({
        ownership: () => {
          throw new Error('db exploded');
        },
      });
      expect((await request(app).get('/x').set(bearer(token))).status).toBe(403);
    });

    it('denies when the ownership predicate rejects, or returns a non-true value', async () => {
      const u = await makeUser('STUDENT');
      const { token } = await loginAs(u.email);
      const rejects = build({ ownership: () => Promise.reject(new Error('boom')) });
      expect((await request(rejects).get('/x').set(bearer(token))).status).toBe(403);
      const truthy = build({ ownership: (() => 'yes') as never });
      expect((await request(truthy).get('/x').set(bearer(token))).status).toBe(403);
    });
  });
});
