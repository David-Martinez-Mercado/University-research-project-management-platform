import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { activeAdminIds, notifyUsers, projectTeamIds } from '../notifications/notifications.service';
import { visibleProjectsWhere } from '../projects/projects.scope';

const scoreValue = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'score must have at most 2 decimal places');

export const saveEvaluationSchema = z
  .object({
    projectId: z.string().uuid(),
    scores: z
      .array(
        z
          .object({
            criterionId: z.string().uuid(),
            score: scoreValue.nullable().optional(),
            comments: z.string().trim().max(2000).nullable().optional(),
          })
          .strict(),
      )
      .max(200),
    // false = save a draft (FR-029); true = final submission (every active criterion must be scored).
    submit: z.boolean().default(false),
  })
  .strict();
export type SaveEvaluationInput = z.infer<typeof saveEvaluationSchema>;

/** The judge's own assignment, with the conflict-of-interest rule re-checked on every access (FR-014). */
async function loadJudgeAssignment(projectId: string, judge: AuthUser) {
  const assignment = await prisma.judgeAssignment.findUnique({
    where: { projectId_judgeId: { projectId, judgeId: judge.id } },
    include: {
      project: {
        select: {
          id: true,
          title: true,
          status: true,
          ownerId: true,
          collaborators: { select: { userId: true } },
        },
      },
    },
  });
  // Not assigned and non-existent are indistinguishable.
  if (!assignment) throw new HttpError(404, 'Project not found');
  const { project } = assignment;
  if (project.ownerId === judge.id || project.collaborators.some((c) => c.userId === judge.id)) {
    throw new HttpError(403, 'You are an author or collaborator of this project and cannot evaluate it', {
      code: 'CONFLICT_OF_INTEREST',
    });
  }
  return assignment;
}

export async function getMyEvaluation(projectId: string, judge: AuthUser) {
  const assignment = await loadJudgeAssignment(projectId, judge);
  const rows = await prisma.evaluation.findMany({ where: { assignmentId: assignment.id } });
  const byCriterion = new Map(rows.map((r) => [r.criterionId, r]));
  const criteria = await prisma.evaluationCriterion.findMany({
    where: { OR: [{ isActive: true }, { id: { in: rows.map((r) => r.criterionId) } }] },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const submitted = assignment.status === 'COMPLETED';
  return {
    projectId,
    project: { id: assignment.project.id, title: assignment.project.title, status: assignment.project.status },
    assignment: { id: assignment.id, status: assignment.status, completedAt: assignment.completedAt },
    state: submitted ? 'SUBMITTED' : rows.length > 0 ? 'DRAFT' : 'NOT_STARTED',
    canEdit: !submitted && assignment.project.status === 'UNDER_EVALUATION',
    criteria: criteria.map((c) => {
      const row = byCriterion.get(c.id);
      return {
        criterionId: c.id,
        name: c.name,
        description: c.description,
        maxScore: c.maxScore,
        weight: Number(c.weight),
        score: row?.score == null ? null : Number(row.score),
        comments: row?.comments ?? null,
      };
    }),
  };
}

/**
 * Saves a draft or submits the final evaluation (FR-012, FR-029, UC-004). All writes happen in ONE transaction, so an
 * interrupted submission never leaves partial final data: either the whole thing is stored or nothing changes.
 * When the last assigned judge submits, the project moves to EVALUATED automatically (FR-024) and its team is told (BR-003).
 */
export async function saveEvaluation(input: SaveEvaluationInput, judge: AuthUser) {
  const assignment = await loadJudgeAssignment(input.projectId, judge);
  if (assignment.project.status !== 'UNDER_EVALUATION') {
    throw new HttpError(409, 'The project is not under evaluation', { status: assignment.project.status });
  }
  if (assignment.status === 'COMPLETED') throw new HttpError(409, 'You already submitted your evaluation');

  const active = await prisma.evaluationCriterion.findMany({ where: { isActive: true } });
  const byId = new Map(active.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const s of input.scores) {
    const criterion = byId.get(s.criterionId);
    if (!criterion) throw new HttpError(422, 'Unknown or inactive criterion', { criterionId: s.criterionId });
    if (seen.has(s.criterionId)) throw new HttpError(400, 'Duplicate criterion in scores', { criterionId: s.criterionId });
    seen.add(s.criterionId);
    if (s.score != null && s.score > criterion.maxScore) {
      throw new HttpError(422, `Score exceeds the maximum (${criterion.maxScore}) of "${criterion.name}"`, {
        criterionId: s.criterionId,
      });
    }
  }

  const closed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${input.projectId}::uuid FOR UPDATE`;

    const existing = await tx.evaluation.findMany({ where: { assignmentId: assignment.id } });
    const merged = new Map<string, number | null>(existing.map((e) => [e.criterionId, e.score == null ? null : Number(e.score)]));
    for (const s of input.scores) {
      if (s.score !== undefined) merged.set(s.criterionId, s.score);
    }
    if (input.submit) {
      const missing = active.filter((c) => merged.get(c.id) == null);
      if (active.length === 0 || missing.length > 0) {
        throw new HttpError(422, active.length === 0 ? 'There is no active rubric to score against' : 'Every criterion must be scored', {
          code: 'INCOMPLETE_EVALUATION',
          missing: missing.map((c) => ({ criterionId: c.id, name: c.name })),
        });
      }
    }

    const status = input.submit ? 'SUBMITTED' : 'DRAFT';
    const now = new Date();
    for (const s of input.scores) {
      await tx.evaluation.upsert({
        where: { assignmentId_criterionId: { assignmentId: assignment.id, criterionId: s.criterionId } },
        create: {
          assignmentId: assignment.id,
          criterionId: s.criterionId,
          score: s.score ?? null,
          comments: s.comments ?? null,
          status,
          submittedAt: input.submit ? now : null,
        },
        update: {
          ...(s.score !== undefined ? { score: s.score } : {}),
          ...(s.comments !== undefined ? { comments: s.comments } : {}),
          status,
          submittedAt: input.submit ? now : null,
        },
      });
    }
    if (input.submit) {
      // Criteria the judge did not touch in this request still need to be flipped to SUBMITTED.
      await tx.evaluation.updateMany({
        where: { assignmentId: assignment.id },
        data: { status: 'SUBMITTED', submittedAt: now },
      });
      await tx.judgeAssignment.update({
        where: { id: assignment.id },
        data: { status: 'COMPLETED', completedAt: now },
      });
      const pending = await tx.judgeAssignment.count({
        where: { projectId: input.projectId, status: { not: 'COMPLETED' } },
      });
      if (pending === 0) {
        await tx.project.update({ where: { id: input.projectId }, data: { status: 'EVALUATED' } });
        return true;
      }
    } else if (assignment.status === 'ASSIGNED') {
      await tx.judgeAssignment.update({ where: { id: assignment.id }, data: { status: 'IN_PROGRESS' } });
    }
    return false;
  });

  if (input.submit) {
    const title = assignment.project.title;
    // Admins hear about every submission immediately; the team only when the period closes (BR-003).
    await notifyUsers(await activeAdminIds(), {
      projectId: input.projectId,
      type: 'EVALUATION_SUBMITTED',
      title: 'Evaluación enviada',
      message: `${judge.fullName} envió su evaluación de «${title}».`,
    });
    if (closed) {
      const links = await prisma.investorProjectLink.findMany({
        where: { projectId: input.projectId },
        select: { investorId: true },
      });
      await notifyUsers([...(await projectTeamIds(input.projectId)), ...links.map((l) => l.investorId)], {
        projectId: input.projectId,
        type: 'PROJECT_STATUS',
        title: 'Evaluación finalizada',
        message: `«${title}» fue evaluado. Ya puedes consultar los resultados.`,
      });
    }
  }
  return { ...(await getMyEvaluation(input.projectId, judge)), projectClosed: closed };
}

/**
 * Aggregated results. BR-003: the team, investors and judges only see them once the project is EVALUATED
 * (or ARCHIVED); an administrator always can, and also gets the per-judge breakdown.
 */
export async function getResults(projectId: string, user: AuthUser) {
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: { id: true, title: true, status: true },
  });
  if (!project) throw new HttpError(404, 'Project not found');

  const isAdmin = user.role === 'ADMINISTRATOR';
  const closed = project.status === 'EVALUATED' || project.status === 'ARCHIVED';
  const [assigned, completed] = await Promise.all([
    prisma.judgeAssignment.count({ where: { projectId } }),
    prisma.judgeAssignment.count({ where: { projectId, status: 'COMPLETED' } }),
  ]);
  const base = { projectId, status: project.status, closed, judgesAssigned: assigned, judgesCompleted: completed };
  if (!closed && !isAdmin) return { ...base, results: null };

  const rows = await prisma.evaluation.findMany({
    where: { status: 'SUBMITTED', assignment: { projectId } },
    include: {
      criterion: true,
      assignment: { select: { judge: { select: { id: true, fullName: true } } } },
    },
    orderBy: [{ criterion: { position: 'asc' } }, { createdAt: 'asc' }],
  });

  const criteria = new Map<
    string,
    { criterionId: string; name: string; maxScore: number; weight: number; scores: number[]; comments: Array<{ judge: string | null; comment: string }> }
  >();
  for (const r of rows) {
    const entry = criteria.get(r.criterionId) ?? {
      criterionId: r.criterionId,
      name: r.criterion.name,
      maxScore: r.criterion.maxScore,
      weight: Number(r.criterion.weight),
      scores: [],
      comments: [],
    };
    if (r.score != null) entry.scores.push(Number(r.score));
    // Only administrators learn which judge wrote what.
    if (r.comments) entry.comments.push({ judge: isAdmin ? r.assignment.judge.fullName : null, comment: r.comments });
    criteria.set(r.criterionId, entry);
  }

  const summary = [...criteria.values()].map((c) => ({
    criterionId: c.criterionId,
    name: c.name,
    maxScore: c.maxScore,
    weight: c.weight,
    average: c.scores.length ? Math.round((c.scores.reduce((a, b) => a + b, 0) / c.scores.length) * 100) / 100 : null,
    comments: c.comments,
  }));
  const scored = summary.filter((c) => c.average !== null);
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
  const overall = totalWeight
    ? Math.round((scored.reduce((s, c) => s + (c.weight * (c.average as number)) / c.maxScore, 0) / totalWeight) * 1000) / 10
    : null;

  return {
    ...base,
    results: {
      overallPercent: overall,
      criteria: summary,
      ...(isAdmin
        ? {
            byJudge: rows.map((r) => ({
              judge: r.assignment.judge.fullName,
              criterionId: r.criterionId,
              score: r.score == null ? null : Number(r.score),
            })),
          }
        : {}),
    },
  };
}

export type { Prisma };
