import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../projects/projects.schemas';

const uuid = z.string().uuid();

export const createAssignmentSchema = z.object({ projectId: uuid, judgeId: uuid }).strict();

const pagination = {
  // Capped, not rejected (same convention as GET /projects).
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, MAX_PAGE_SIZE)),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};

export const listAssignmentsQuerySchema = z.object({ projectId: uuid.optional(), ...pagination });
export const judgeProjectsQuerySchema = z.object({ ...pagination });

export const idParamSchema = z.object({ id: uuid });

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;
export type JudgeProjectsQuery = z.infer<typeof judgeProjectsQuerySchema>;
