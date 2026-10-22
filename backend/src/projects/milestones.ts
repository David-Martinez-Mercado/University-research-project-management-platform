import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import type { AuthUser } from '../middleware/authenticate';
import { visibleProjectsWhere } from './projects.scope';

const ALL_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE', 'INVESTOR'] as const;
const TEAM_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT'] as const;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const createSchema = z.object({ title: z.string().trim().min(1).max(200), dueDate: dateOnly.nullable().optional() }).strict();
const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueDate: dateOnly.nullable(),
    completed: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
const projectParam = z.object({ id: z.string().uuid() });
const milestoneParams = z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() });

export function toPublicMilestone(m: {
  id: string;
  title: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: m.id,
    title: m.title,
    dueDate: m.dueDate ? m.dueDate.toISOString().slice(0, 10) : null,
    completed: m.completedAt !== null,
    completedAt: m.completedAt,
    createdAt: m.createdAt,
  };
}

export function progressPercent(milestones: Array<{ completedAt: Date | null }>): number {
  if (milestones.length === 0) return 0;
  return Math.round((milestones.filter((m) => m.completedAt).length / milestones.length) * 100);
}

async function loadVisible(projectId: string, user: AuthUser) {
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: { id: true, ownerId: true, status: true, collaborators: { where: { userId: user.id }, select: { userId: true } } },
  });
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

/** Only the team (owner, any collaborator) or an administrator may edit, and only until evaluation starts (FR-017). */
async function loadEditable(projectId: string, user: AuthUser) {
  const project = await loadVisible(projectId, user);
  const isTeam = project.ownerId === user.id || project.collaborators.length > 0 || user.role === 'ADMINISTRATOR';
  if (!isTeam) throw new HttpError(403, 'Only the project team can update progress');
  if (!['DRAFT', 'SUBMITTED'].includes(project.status)) {
    throw new HttpError(409, 'Progress cannot be changed once the project is under evaluation', { status: project.status });
  }
  return project;
}

async function list(projectId: string) {
  const rows = await prisma.milestone.findMany({
    where: { projectId },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  return { data: rows.map(toPublicMilestone), progressPercent: progressPercent(rows) };
}

/** Mounted at /projects. */
export const milestonesRouter = Router();

milestonesRouter.get(
  '/:id/milestones',
  ...authorize({ roles: [...ALL_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectParam.parse(req.params);
    await loadVisible(id, req.user!);
    res.json(await list(id));
  }),
);

milestonesRouter.post(
  '/:id/milestones',
  ...authorize({ roles: [...TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectParam.parse(req.params);
    const input = createSchema.parse(req.body);
    await loadEditable(id, req.user!);
    const created = await prisma.milestone.create({
      data: {
        projectId: id,
        title: input.title,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdById: req.user!.id,
      },
    });
    res.status(201).json({ milestone: toPublicMilestone(created), ...(await list(id)) });
  }),
);

milestonesRouter.put(
  '/:id/milestones/:milestoneId',
  ...authorize({ roles: [...TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id, milestoneId } = milestoneParams.parse(req.params);
    const patch = updateSchema.parse(req.body);
    await loadEditable(id, req.user!);
    const existing = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId: id } });
    if (!existing) throw new HttpError(404, 'Milestone not found');
    await prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ? new Date(patch.dueDate) : null } : {}),
        ...(patch.completed !== undefined ? { completedAt: patch.completed ? (existing.completedAt ?? new Date()) : null } : {}),
      },
    });
    res.json(await list(id));
  }),
);

milestonesRouter.delete(
  '/:id/milestones/:milestoneId',
  ...authorize({ roles: [...TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id, milestoneId } = milestoneParams.parse(req.params);
    await loadEditable(id, req.user!);
    const result = await prisma.milestone.deleteMany({ where: { id: milestoneId, projectId: id } });
    if (result.count === 0) throw new HttpError(404, 'Milestone not found');
    res.status(204).end();
  }),
);
