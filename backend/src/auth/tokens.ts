import jwt from 'jsonwebtoken';
import { env } from '../config/env';

// The token carries only the user id. Role, active flag, etc. are re-read from the
// database on every request, so role changes and deactivations apply immediately.
export function signAccessToken(userId: string): { token: string; expiresInSeconds: number } {
  const expiresInSeconds = env.JWT_INACTIVITY_MINUTES * 60;
  const token = jwt.sign({}, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: expiresInSeconds,
  });
  return { token, expiresInSeconds };
}

/** Throws if the token is malformed, tampered with or expired. */
export function verifyAccessToken(token: string): { sub: string } {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new Error('Invalid token payload');
  }
  return { sub: payload.sub };
}
