import { Role } from '@prisma/client';
import { z } from 'zod';

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

export const idParamSchema = z.object({ id: z.string().uuid() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
