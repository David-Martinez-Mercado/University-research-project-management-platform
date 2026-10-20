import { Prisma, type ProjectStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { toPublicProject } from '../projects/projects.service';
import { visibleProjectsWhere } from '../projects/projects.scope';
import { evaluateConflictOfInterest } from './judging.coi';
import type { CreateAssignmentInput, JudgeProjectsQuery, ListAssignmentsQuery } from './judging.schemas';

/** A judge can only be assigned while the project is waiting for / in evaluation. */
export const ASSIGNABLE_STATUSES: readonly ProjectStatus[] = ['SUBMITTED', 'UNDER_EVALUATION'];

const assignmentInclude = {
  judge: { select: { id: true, fullName: true, email: true, affiliation: true } },
  project: { select: { id: true, title: true, status: true } },
} satisfies Prisma.JudgeAssignmentInclude;
type AssignmentRow = Prisma.JudgeAssignmentGetPayload<{ include: typeof assignmentInclude }>;

export function toPublicAssignment(a: AssignmentRow) {
  return {
    id: a.id,
    projectId: a.projectId,
    judgeId: a.judgeId,
    assignedById: a.assignedById,
    status: a.status,
    assignedAt: a.assignedAt,
    completedAt: a.completedAt,
    judge: a.judge,
    project: a.project,
  };
}

/**
 * Assigns a judge to a project (administrators only; enforced by the route).
 *
 * The conflict-of-interest check (FR-010) runs INSIDE the same transaction as the insert,
 * after locking the project row (FOR UPDATE) and the judge row (FOR NO KEY UPDATE):
 *  - a collaborator insert / affiliation edit / status change that is still in flight either
 *    commits first (and is then seen by the checks below) or waits until this transaction ends;
 *  - two concurrent identical assignments serialize, and the unique(projectId, judgeId)
 *    constraint turns the loser into a 409.
 * A conflict REJECTS the assignment (422); it is never downgraded to a warning.
 */
export async function createAssignment(input: CreateAssignmentInput, admin: AuthUser) {
  try {
    const row = await prisma.$transaction(async (tx) => {
      // Fixed lock order (project, then user) to avoid deadlocks between concurrent assignments.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${input.projectId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.judgeId}::uuid FOR NO KEY UPDATE`;

      const project = await tx.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { select: { userId: true } } },
      });
      if (!project) throw new HttpError(404, 'Project not found');
      const judge = await tx.user.findUnique({ where: { id: input.judgeId } });
      if (!judge) throw new HttpError(404, 'Judge not found');

      if (judge.role !== 'JUDGE') {
        throw new HttpError(422, 'The selected user does not have the JUDGE role');
      }
      if (!judge.isActive) throw new HttpError(422, 'The selected judge is deactivated');
      if (!ASSIGNABLE_STATUSES.includes(project.status)) {
        throw new HttpError(
          409,
          `Project is ${project.status}; judges can only be assigned while it is ${ASSIGNABLE_STATUSES.join(' or ')}`,
        );
      }

      const existing = await tx.judgeAssignment.findUnique({
        where: { projectId_judgeId: { projectId: project.id, judgeId: judge.id } },
        select: { id: true },
      });
      if (existing) throw new HttpError(409, 'This judge is already assigned to this project');

      const { conflicts, unverifiable } = evaluateConflictOfInterest({
        judge: { id: judge.id, affiliation: judge.affiliation },
        project: { ownerId: project.ownerId, affiliation: project.affiliation },
        collaboratorIds: project.collaborators.map((c) => c.userId),
      });
      if (conflicts.length > 0) {
        throw new HttpError(
          422,
          `Conflict of interest: assignment rejected because ${conflicts.map((c) => c.message).join('; ')}`,
          { code: 'CONFLICT_OF_INTEREST', reasons: [...conflicts, ...unverifiable] },
        );
      }
      if (unverifiable.length > 0) {
        // Fail closed: without both affiliations the rule cannot be evaluated.
        throw new HttpError(
          422,
          `Cannot verify conflict of interest, assignment rejected: ${unverifiable.map((u) => u.message).join('; ')}`,
          { code: 'AFFILIATION_REQUIRED', reasons: unverifiable },
        );
      }

      return tx.judgeAssignment.create({
        data: { projectId: project.id, judgeId: judge.id, assignedById: admin.id },
        include: assignmentInclude,
      });
    });
    return toPublicAssignment(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'This judge is already assigned to this project');
    }
    throw err;
  }
}

export async function listAssignments(query: ListAssignmentsQuery) {
  const where: Prisma.JudgeAssignmentWhereInput = query.projectId ? { projectId: query.projectId } : {};
  const [rows, total] = await prisma.$transaction([
    prisma.judgeAssignment.findMany({
      where,
      include: assignmentInclude,
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.judgeAssignment.count({ where }),
  ]);
  return { data: rows.map(toPublicAssignment), total, limit: query.limit, offset: query.offset };
}

/** Removes an assignment, but only while it has no evaluations (they would be destroyed by the cascade). */
export async function deleteAssignment(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock the assignment row: an evaluation insert (FK → key-share lock) waits for this
    // transaction, so none can appear between the count below and the delete.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM judge_assignments WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new HttpError(404, 'Assignment not found');
    const evaluations = await tx.evaluation.count({ where: { assignmentId: id } });
    if (evaluations > 0) {
      throw new HttpError(409, 'This assignment already has evaluations and cannot be removed');
    }
    await tx.judgeAssignment.delete({ where: { id } });
  });
}

/**
 * Projects assigned to a judge. The scope is the shared `visibleProjectsWhere` fragment
 * applied to the TARGET judge, ANDed with the caller's own scope (so a judge can only ever
 * resolve to their own rows). All filtering happens in the database query.
 */
export async function listJudgeProjects(judgeId: string, query: JudgeProjectsQuery, caller: AuthUser) {
  const judge = await prisma.user.findUnique({ where: { id: judgeId }, select: { id: true, role: true } });
  if (!judge || judge.role !== 'JUDGE') throw new HttpError(404, 'Judge not found');

  const where: Prisma.ProjectWhereInput = {
    AND: [visibleProjectsWhere({ id: judge.id, role: 'JUDGE' }), visibleProjectsWhere(caller)],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      include: {
        judgeAssignments: {
          where: { judgeId: judge.id },
          select: { id: true, status: true, assignedAt: true, completedAt: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.project.count({ where }),
  ]);
  return {
    data: rows.map(({ judgeAssignments, ...project }) => ({
      ...toPublicProject(project),
      assignment: judgeAssignments[0] ?? null,
    })),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}
