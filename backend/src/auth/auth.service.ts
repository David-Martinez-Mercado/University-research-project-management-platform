import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import { createUser, isUniqueViolation, toPublicUser } from '../users/users.service';
import { signAccessToken } from './tokens';

const INVALID_CREDENTIALS = 'Invalid email or password';

// Compared against when the email is unknown, so response time does not reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

/**
 * NFR-013: records a failed attempt in ONE atomic statement. The row lock serialises
 * concurrent guesses, so parallel requests cannot dodge the counter. A failure outside the
 * window restarts the count at 1; reaching the limit inside the window locks the account.
 */
async function registerFailedAttempt(userId: string, now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000);
  const lockUntil = new Date(now.getTime() + env.LOCKOUT_MINUTES * 60_000);
  const max = env.LOGIN_MAX_FAILED_ATTEMPTS;
  await prisma.$executeRaw`
    UPDATE users SET
      failed_login_count = CASE WHEN first_failed_login_at > ${windowStart}::timestamptz
                                THEN failed_login_count + 1 ELSE 1 END,
      first_failed_login_at = CASE WHEN first_failed_login_at > ${windowStart}::timestamptz
                                   THEN first_failed_login_at ELSE ${now}::timestamptz END,
      locked_until = CASE WHEN (CASE WHEN first_failed_login_at > ${windowStart}::timestamptz
                                     THEN failed_login_count + 1 ELSE 1 END) >= ${max}::int
                          THEN ${lockUntil}::timestamptz ELSE locked_until END
    WHERE id = ${userId}::uuid`;
}

export async function login(email: string, password: string) {
  const now = new Date();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
    throw new HttpError(423, 'Account temporarily locked after too many failed attempts', {
      retryAfterSeconds,
    });
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    // Deactivated accounts get the same answer as a wrong password.
    if (user.isActive) await registerFailedAttempt(user.id, now);
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null, lastLoginAt: now },
  });
  const { token, expiresInSeconds } = signAccessToken(user.id);
  return { token, expiresInSeconds, user: toPublicUser(updated) };
}

const sha256 = (v: string) => createHash('sha256').update(v).digest();
const secretsMatch = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b));

/**
 * Creates the first Administrator. Once any owner exists the endpoint answers 404, and a
 * partial unique index on users(is_owner) enforces "at most one owner" even under races.
 */
export async function bootstrapOwner(
  input: { email: string; password: string; fullName: string; affiliation?: string },
  providedSecret: string | undefined,
) {
  const ownerExists = async () => (await prisma.user.count({ where: { isOwner: true } })) > 0;
  const notFound = () => new HttpError(404, 'Not found');

  if (await ownerExists()) throw notFound();

  if (env.BOOTSTRAP_OWNER_SECRET) {
    if (!providedSecret || !secretsMatch(providedSecret, env.BOOTSTRAP_OWNER_SECRET)) {
      throw new HttpError(403, 'Forbidden');
    }
  }

  try {
    return await createUser({ ...input, role: 'ADMINISTRATOR' }, { isOwner: true });
  } catch (err) {
    // Lost a race against another bootstrap request.
    if ((err instanceof HttpError && err.status === 409) || isUniqueViolation(err)) {
      if (await ownerExists()) throw notFound();
    }
    throw err;
  }
}
