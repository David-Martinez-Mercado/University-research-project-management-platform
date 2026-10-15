import type { Role } from '@prisma/client';
import type { RequestHandler } from 'express';
import { signAccessToken, verifyAccessToken } from '../auth/tokens';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import { asyncHandler } from './asyncHandler';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Validates the Bearer token, then re-reads the user from the database so the role and
 * active flag are always current (never trusted from the token). On success it issues a
 * fresh token in `X-Auth-Token`, which implements the 30-minute INACTIVITY expiry.
 * Missing / invalid / expired token, unknown or deactivated user → 401.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, res, next) => {
  const header = req.header('authorization');
  if (!header || !/^Bearer\s+\S+$/i.test(header)) {
    throw new HttpError(401, 'Authentication required');
  }
  const token = header.replace(/^Bearer\s+/i, '');

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new HttpError(401, 'Invalid or expired token');
  }

  req.user = { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
  res.setHeader('X-Auth-Token', signAccessToken(user.id).token);
  next();
});
