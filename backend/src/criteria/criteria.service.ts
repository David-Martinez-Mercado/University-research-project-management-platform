import type { EvaluationCriterion } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { visibleProjectsWhere } from '../projects/projects.scope';
import type { CreateCriterionInput, UpdateCriterionInput } from './criteria.schemas';

/** Shape returned by the API (`weight` is a DECIMAL in the database; exposed as a number). */
export function toPublicCriterion(c: EvaluationCriterion) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    maxScore: c.maxScore,
    weight: Number(c.weight),
    position: c.position,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const ORDER = [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

export async function listCriteria(includeInactive: boolean) {
  const rows = await prisma.evaluationCriterion.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [...ORDER],
  });
  return rows.map(toPublicCriterion);
}

export async function createCriterion(input: CreateCriterionInput, admin: AuthUser) {
  const row = await prisma.evaluationCriterion.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      maxScore: input.maxScore,
      weight: input.weight,
      position: input.position,
      isActive: input.isActive,
      createdById: admin.id,
    },
  });
  return toPublicCriterion(row);
}

/** There is no hard delete: criteria referenced by evaluations must survive. Deactivate with `isActive: false`. */
export async function updateCriterion(id: string, patch: UpdateCriterionInput) {
  const existing = await prisma.evaluationCriterion.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, 'Criterion not found');
  const row = await prisma.evaluationCriterion.update({ where: { id }, data: patch });
  return toPublicCriterion(row);
}

/** Active criteria, in order, for a project the caller can see (visibility is in the query → 404). */
export async function getProjectRubric(projectId: string, user: AuthUser) {
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, 'Project not found');
  return { projectId: project.id, data: await listCriteria(false) };
}
