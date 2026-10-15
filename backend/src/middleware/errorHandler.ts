import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

// Never logs request bodies (they may contain passwords).
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    if (err.extra?.retryAfterSeconds) {
      res.setHeader('Retry-After', String(err.extra.retryAfterSeconds));
    }
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  return res.status(500).json({ error: 'Internal server error' });
};
