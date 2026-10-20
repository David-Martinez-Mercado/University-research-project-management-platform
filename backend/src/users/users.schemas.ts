import { Role } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../projects/projects.schemas';

export const email = z.string().trim().toLowerCase().email().max(254);

// bcrypt only uses the first 72 BYTES; reject longer passwords instead of silently truncating.
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const roleSchema = z.nativeEnum(Role);

export const createUserSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(1).max(200),
  role: roleSchema,
  affiliation: z.string().trim().max(200).optional(),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    role: roleSchema,
    affiliation: z.string().trim().max(200).nullable(),
    isActive: z.boolean(),
    // Admin password reset. Also clears any lockout.
    password,
    // Clears failed-attempt counters and lockout without changing the password.
    unlockAccount: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const listUsersQuerySchema = z.object({
  role: roleSchema.optional(),
  // Case-insensitive substring match on email or full name. Blank = no filter.
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Capped, not rejected (same convention as GET /projects).
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, MAX_PAGE_SIZE)),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
