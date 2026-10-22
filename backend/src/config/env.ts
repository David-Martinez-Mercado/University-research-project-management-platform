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
    // Uploaded project documents. Local disk for now (ephemeral on Render — see docs/ROADMAP.md).
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
    // AI/RAG embeddings (see docs/AI_RAG.md). `mock` is deterministic and offline (dev/test only).
    EMBEDDING_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    EMBEDDING_API_KEY: optionalString,
    EMBEDDING_API_URL: z.string().url().default('https://api.openai.com/v1/embeddings'),
    EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(64),
    EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    // AI assistant answers (FR-007). `mock` builds an extractive answer from the retrieved passages (dev/test only).
    LLM_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    LLM_API_KEY: optionalString,
    LLM_API_URL: z.string().url().default('https://api.openai.com/v1/chat/completions'),
    LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
    // FR-028: the assistant must answer or fall back within 10 s.
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    // AIR-004: below this best-chunk cosine similarity the assistant refuses instead of answering.
    AI_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.15),
    AI_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.EMBEDDING_PROVIDER === 'openai' && !cfg.EMBEDDING_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMBEDDING_API_KEY'],
        message: 'EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai',
      });
    }
    if (cfg.LLM_PROVIDER === 'openai' && !cfg.LLM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_API_KEY'],
        message: 'LLM_API_KEY is required when LLM_PROVIDER=openai',
      });
    }
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
