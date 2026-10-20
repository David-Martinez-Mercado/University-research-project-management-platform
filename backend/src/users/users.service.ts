import { Prisma, type Role, type User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './users.schemas';

/** Shape returned by the API: never includes password hash or lockout internals. */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    affiliation: user.affiliation,
    isActive: user.isActive,
    isOwner: user.isOwner,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function createUser(input: CreateUserInput, extra: { isOwner?: boolean } = {}) {
  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await hashPassword(input.password),
        fullName: input.fullName,
        role: input.role,
        affiliation: input.affiliation,
        isOwner: extra.isOwner ?? false,
      },
    });
    return toPublicUser(user);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'A user with this email already exists');
    throw err;
  }
}

// Prisma's `contains` does not escape LIKE wildcards; PostgreSQL's default LIKE escape is a backslash.
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.q
      ? {
          OR: [
            { email: { contains: escapeLike(query.q), mode: 'insensitive' } },
            { fullName: { contains: escapeLike(query.q), mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.user.count({ where }),
  ]);
  return { data: rows.map(toPublicUser), total, limit: query.limit, offset: query.offset };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'User not found');
  return toPublicUser(user);
}

export async function updateUser(id: string, patch: UpdateUserInput) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'User not found');

  // The owner (first administrator) cannot be demoted or deactivated through the API,
  // otherwise the system could be left with no administrator.
  if (target.isOwner) {
    const demoting = patch.role !== undefined && (patch.role as Role) !== 'ADMINISTRATOR';
    const deactivating = patch.isActive === false;
    if (demoting || deactivating) {
      throw new HttpError(409, 'The owner account cannot be demoted or deactivated');
    }
  }

  const data: Prisma.UserUpdateInput = {};
  if (patch.fullName !== undefined) data.fullName = patch.fullName;
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.affiliation !== undefined) data.affiliation = patch.affiliation;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.password !== undefined) data.passwordHash = await hashPassword(patch.password);
  if (patch.password !== undefined || patch.unlockAccount) {
    data.failedLoginCount = 0;
    data.firstFailedLoginAt = null;
    data.lockedUntil = null;
  }

  const updated = await prisma.user.update({ where: { id }, data });
  return toPublicUser(updated);
}
