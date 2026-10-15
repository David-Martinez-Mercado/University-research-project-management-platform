import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

/** Per-IP limiter for unauthenticated endpoints. Complements (does not replace) account lockout. */
export function ipRateLimit(limit: number, windowMinutes: number): RequestHandler {
  if (!env.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
}
