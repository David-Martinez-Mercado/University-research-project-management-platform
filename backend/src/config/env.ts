import 'dotenv/config';
import { z } from 'zod';

// Empty strings in .env (e.g. `BOOTSTRAP_OWNER_SECRET=`) are treated as "not set".
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    // Sliding window: every authenticated request returns a fresh token (X-Auth-Token),
    // so a token only expires after this many minutes WITHOUT activity.
    JWT_INACTIVITY_MINUTES: z.coerce.number().int().positive().default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    // NFR-013: 5 failed attempts within 10 minutes locks the account.
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
    LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    // Guards POST /auth/bootstrap-owner. Required in production.
    BOOTSTRAP_OWNER_SECRET: optionalString,
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production' && !cfg.BOOTSTRAP_OWNER_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BOOTSTRAP_OWNER_SECRET'],
        message: 'BOOTSTRAP_OWNER_SECRET is required in production (otherwise anyone could claim the owner account)',
      });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

// Intentionally a plain mutable object so tests can tweak values.
export const env = parsed.data;
