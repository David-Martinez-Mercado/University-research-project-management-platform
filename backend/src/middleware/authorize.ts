import type { Role } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { authenticate, type AuthUser } from './authenticate';
import { HttpError } from '../errors';

export interface AuthorizeOptions {
  /** Roles allowed unconditionally. */
  roles?: Role[];
  /**
   * Resource-ownership predicate, evaluated on EVERY request against current data.
   * Passing either `roles` or `ownership` grants access; if only one is given, only
   * that one is considered.
   */
  ownership?: (req: Request, user: AuthUser) => boolean | Promise<boolean>;
}

/**
 * RBAC (FR-030): authenticates, then revalidates role and ownership per request.
 * DEFAULT DENY: no rule configured, a failing rule, or a rule that throws → 403.
 * Returns a middleware chain: use as `router.get('/x', ...authorize({...}), handler)`.
 */
export function authorize(options: AuthorizeOptions): RequestHandler[] {
  const check: RequestHandler = async (req, _res, next) => {
    try {
      const user = req.user;
      if (!user) return next(new HttpError(403, 'Forbidden'));

      const roleOk = options.roles?.includes(user.role) ?? false;
      if (roleOk) return next();

      if (options.ownership && (await options.ownership(req, user)) === true) return next();

      return next(new HttpError(403, 'Forbidden'));
    } catch {
      // A broken rule must never grant access.
      return next(new HttpError(403, 'Forbidden'));
    }
  };
  return [authenticate, check];
}
