import { z } from 'zod';
import { email, password } from '../users/users.schemas';

export const loginSchema = z.object({
  email,
  // No length rule on login: never leak the password policy to unauthenticated callers.
  password: z.string().min(1).max(1024),
});

export const bootstrapOwnerSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(1).max(200),
  affiliation: z.string().trim().max(200).optional(),
});
