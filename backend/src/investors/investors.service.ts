import { Prisma, type ProjectStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { getResults } from '../evaluations/evaluations.service';
import { notifyUsers } from '../notifications/notifications.service';
import { progressPercent, toPublicMilestone } from '../projects/milestones';
import { allowedNextStatuses } from '../projects/projects.lifecycle';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../projects/projects.schemas';
import { visibleProjectsWhere } from '../projects/projects.scope';
import { renderProjectReport } from './report';

const uuid = z.string().uuid();
const pagination = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, MAX_PAGE_SIZE)),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};

export const createLinkSchema = z.object({ investorId: uuid, projectId: uuid }).strict();
export const listLinksQuerySchema = z.object({ projectId: uuid.optional(), investorId: uuid.optional(), ...pagination });
export const dashboardQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_EVALUATION', 'EVALUATED', 'ARCHIVED']).optional(),
  researchArea: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ...pagination,
});
export const idParamSchema = z.object({ id: uuid });

const linkInclude = {
  investor: { select: { id: true, fullName: true, email: true } },
  project: { select: { id: true, title: true, status: true } },
} as const;
type LinkRow = Prisma.InvestorProjectLinkGetPayload<{ include: typeof linkInclude }>;

const toPublicLink = (l: LinkRow) => ({
  id: l.id,
  investorId: l.investorId,
  projectId: l.projectId,
  linkedById: l.linkedById,
  createdAt: l.createdAt,
  investor: l.investor,
  project: l.project,
});

export async function createLink(input: z.infer<typeof createLinkSchema>, admin: AuthUser) {
  const [investor, project] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.investorId }, select: { id: true, role: true, isActive: true } }),
    prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true, title: true } }),
  ]);
  if (!investor || !project) throw new HttpError(404, 'Investor or project not found');
  if (investor.role !== 'INVESTOR') throw new HttpError(422, 'The selected user does not have the INVESTOR role');
  if (!investor.isActive) throw new HttpError(422, 'The selected investor is deactivated');
  try {
    const row = await prisma.investorProjectLink.create({
      data: { investorId: investor.id, projectId: project.id, linkedById: admin.id },
      include: linkInclude,
    });
    await notifyUsers([investor.id], {
      projectId: project.id,
      type: 'SYSTEM',
      title: 'Nuevo proyecto vinculado',
      message: `Ahora puedes consultar el avance de «${project.title}».`,
    });
    return toPublicLink(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'This investor is already linked to this project');
    }
    throw err;
  }
}

export async function listLinks(query: z.infer<typeof listLinksQuerySchema>) {
  const where: Prisma.InvestorProjectLinkWhereInput = {
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.investorId ? { investorId: query.investorId } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.investorProjectLink.findMany({
      where,
      include: linkInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.investorProjectLink.count({ where }),
  ]);
  return { data: rows.map(toPublicLink), total, limit: query.limit, offset: query.offset };
}

export async function deleteLink(id: string): Promise<void> {
  const result = await prisma.investorProjectLink.deleteMany({ where: { id } });
  if (result.count === 0) throw new HttpError(404, 'Link not found');
}

/** Read-only dashboard (FR-015, FR-016). Scoped to the investor's linked projects inside the query (BR-007). */
export async function getDashboard(investorId: string, query: z.infer<typeof dashboardQuerySchema>, caller: AuthUser) {
  if (caller.role !== 'ADMINISTRATOR' && caller.id !== investorId) throw new HttpError(403, 'Forbidden');
  const investor = await prisma.user.findUnique({ where: { id: investorId }, select: { id: true, role: true } });
  if (!investor || investor.role !== 'INVESTOR') throw new HttpError(404, 'Investor not found');

  const base: Prisma.ProjectWhereInput = { investorLinks: { some: { investorId } } };
  const filters: Prisma.ProjectWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.researchArea ? { researchArea: { contains: query.researchArea, mode: 'insensitive' } } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };
  const where: Prisma.ProjectWhereInput = { AND: [base, filters] };

  const [rows, total, grouped, areas] = await Promise.all([
    prisma.project.findMany({
      where,
      include: { milestones: true, owner: { select: { fullName: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.project.count({ where }),
    prisma.project.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.project.findMany({ where: base, select: { researchArea: true }, distinct: ['researchArea'] }),
  ]);

  const data = await Promise.all(
    rows.map(async (p) => {
      const evaluation = await getResults(p.id, { ...caller, id: investorId, role: 'INVESTOR' });
      return {
        id: p.id,
        title: p.title,
        summary: p.summary,
        researchArea: p.researchArea,
        status: p.status,
        ownerName: p.owner.fullName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        progressPercent: progressPercent(p.milestones),
        milestones: p.milestones
          .map(toPublicMilestone)
          .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
        evaluation: {
          judgesAssigned: evaluation.judgesAssigned,
          judgesCompleted: evaluation.judgesCompleted,
          closed: evaluation.closed,
          // Scores are only exposed after the evaluation closes (BR-003).
          overallPercent: evaluation.results?.overallPercent ?? null,
        },
      };
    }),
  );

  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<ProjectStatus, number>>;
  return {
    investorId,
    summary: {
      totalLinked: Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0),
      byStatus,
      researchAreas: areas.map((a) => a.researchArea).filter((a): a is string => !!a).sort(),
    },
    data,
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

/** PDF progress/evaluation report (FR-018). Visible to the investor linked, the assigned judge and administrators. */
export async function buildReport(projectId: string, user: AuthUser): Promise<{ fileName: string; pdf: Buffer }> {
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    include: { milestones: true, owner: { select: { fullName: true } } },
  });
  if (!project) throw new HttpError(404, 'Project not found');
  const evaluation = await getResults(projectId, user);
  try {
    const pdf = await renderProjectReport({
      title: project.title,
      status: project.status,
      allowedNext: allowedNextStatuses(project.status),
      owner: project.owner.fullName,
      researchArea: project.researchArea,
      affiliation: project.affiliation,
      summary: project.summary,
      description: project.description,
      createdAt: project.createdAt,
      progressPercent: progressPercent(project.milestones),
      milestones: project.milestones.map(toPublicMilestone),
      evaluation,
      generatedBy: user.fullName,
    });
    const slug = project.title.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'proyecto';
    return { fileName: `reporte-${slug}.pdf`, pdf };
  } catch (err) {
    // FR-031: a failed generation is reported as such; no partial file is served.
    if (err instanceof HttpError) throw err;
    console.error('[report] generation failed', { reason: (err as Error)?.name });
    throw new HttpError(503, 'Report generation failed, please retry', { code: 'REPORT_FAILED' });
  }
}
