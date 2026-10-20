import { CollaboratorRole, ProjectStatus } from '@prisma/client';
import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

const title = z.string().trim().min(1).max(300);
const summary = z.string().trim().max(2000);
const description = z.string().trim().max(20000);
const researchArea = z.string().trim().max(200);
const affiliation = z.string().trim().max(200);

// .strict(): unknown keys (ownerId, status, submittedAt, ...) are rejected with 400
// instead of being silently ignored, so nothing privileged can ride along in the body.
export const createProjectSchema = z
  .object({
    title,
    summary: summary.optional(),
    description: description.optional(),
    researchArea: researchArea.optional(),
    affiliation: affiliation.optional(),
  })
  .strict();

export const updateProjectSchema = z
  .object({
    title,
    summary: summary.nullable(),
    description: description.nullable(),
    researchArea: researchArea.nullable(),
    affiliation: affiliation.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const changeStatusSchema = z.object({ status: z.nativeEnum(ProjectStatus) }).strict();

export const listProjectsQuerySchema = z.object({
  status: z.nativeEnum(ProjectStatus).optional(),
  // Capped, not rejected: asking for 10000 yields MAX_PAGE_SIZE rows.
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, MAX_PAGE_SIZE)),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// Exactly one of `userId` / `email`. Looking a user up by email lets project managers add
// collaborators without knowing UUIDs (there is no user directory for non-admins).
// Defined here (not imported from users.schemas) to avoid a circular import.
export const addCollaboratorSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    role: z.nativeEnum(CollaboratorRole).default('MEMBER'),
  })
  .strict()
  .refine((v) => (v.userId === undefined) !== (v.email === undefined), {
    message: 'Provide exactly one of userId or email',
    path: ['userId'],
  });

export const projectIdParamSchema = z.object({ id: z.string().uuid() });
export const collaboratorParamsSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type AddCollaboratorInput = z.infer<typeof addCollaboratorSchema>;
