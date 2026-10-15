import type { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';

export const api = () => request(app);
export const PASSWORD = 'correct-horse-battery';

export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
}

let counter = 0;
export async function makeUser(
  role: Role,
  overrides: Partial<{ email: string; isActive: boolean; isOwner: boolean; password: string }> = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${role.toLowerCase()}${counter}@test.local`,
      passwordHash: await bcrypt.hash(overrides.password ?? PASSWORD, env.BCRYPT_ROUNDS),
      fullName: `Test ${role} ${counter}`,
      role,
      isActive: overrides.isActive ?? true,
      isOwner: overrides.isOwner ?? false,
    },
  });
}

export async function loginAs(email: string, password = PASSWORD) {
  const res = await api().post('/auth/login').send({ email, password });
  return { res, token: res.body.token as string };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Signs a token with the real secret but arbitrary timing, to simulate expiry/inactivity. */
export function tokenWithTiming(userId: string, issuedSecondsAgo: number, lifetimeSeconds: number) {
  const iat = Math.floor(Date.now() / 1000) - issuedSecondsAgo;
  return jwt.sign({ iat, exp: iat + lifetimeSeconds }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
  });
}
