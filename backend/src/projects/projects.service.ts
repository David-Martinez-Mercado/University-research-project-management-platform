import { Prisma, type CollaboratorRole, type Project, type ProjectStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { allowedNextStatuses, findTransition, missingForSubmission } from './projects.lifecycle';
import type {
  AddCollaboratorInput,
  CreateProjectInput,
  ListProjectsQuery,
  UpdateProjectInput,
} from './projects.schemas';
import { visibleProjectsWhere } from './projects.scope';

/** Shape returned by the API. */
export function toPublicProject(p: Project) {
  return {
    id: p.id,
    ownerId: p.ownerId,
    title: p.title,
    summary: p.summary,
    description: p.description,
    researchArea: p.researchArea,
    affiliation: p.affiliation,
    status: p.status,
    allowedNextStatuses: allowedNextStatuses(p.status),
    submittedAt: p.submittedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

interface LoadedProject {
  project: Project;
  isOwner: boolean;
  isLead: boolean;
  isAdmin: boolean;
  /** Owner, LEAD collaborator or ADMINISTRATOR. */
  canManage: boolean;
}

/**
 * Loads a project ONLY if the caller may see it (scoping is part of the WHERE clause).
 * Invisible and non-existent projects are indistinguishable: both → 404.
 */
async function loadVisibleProject(id: string, user: AuthUser): Promise<LoadedProject> {
  const row = await prisma.project.findFirst({
    where: { AND: [{ id }, visibleProjectsWhere(user)] },
    include: { collaborators: { where: { userId: user.id }, select: { role: true } } },
  });
  if (!row) throw new HttpError(404, 'Project not found');
  const { collaborators, ...project } = row;
  const isOwner = project.ownerId === user.id;
  const isLead = collaborators.some((c) => c.role === 'LEAD');
  const isAdmin = user.role === 'ADMINISTRATOR';
  return { project, isOwner, isLead, isAdmin, canManage: isOwner || isLead || isAdmin };
}

/** Visible project the caller is allowed to manage; otherwise 404 (invisible) or 403 (visible). */
async function loadManageableProject(id: string, user: AuthUser): Promise<LoadedProject> {
  const loaded = await loadVisibleProject(id, user);
  if (!loaded.canManage) {
    throw new HttpError(403, 'Only the project owner, a lead collaborator or an administrator can do this');
  }
  return loaded;
}

export async function createProject(input: CreateProjectInput, user: AuthUser) {
  const creator = await prisma.user.findUnique({ where: { id: user.id }, select: { affiliation: true } });
  const project = await prisma.project.create({
    data: {
      ownerId: user.id, // always the caller, never taken from the body
      title: input.title,
      summary: input.summary,
      description: input.description,
      researchArea: input.researchArea,
      affiliation: input.affiliation ?? creator?.affiliation ?? null,
    },
  });
  return toPublicProject(project);
}

export async function listProjects(query: ListProjectsQuery, user: AuthUser) {
  const where: Prisma.ProjectWhereInput = {
    AND: [visibleProjectsWhere(user), query.status ? { status: query.status } : {}],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.project.count({ where }),
  ]);
  return { data: rows.map(toPublicProject), total, limit: query.limit, offset: query.offset };
}

export async function getProject(id: string, user: AuthUser) {
  const { project } = await loadVisibleProject(id, user);
  return toPublicProject(project);
}

export async function updateProject(id: string, patch: UpdateProjectInput, user: AuthUser) {
  const { project, isAdmin } = await loadManageableProject(id, user);
  if (!isAdmin && project.status !== 'DRAFT') {
    throw new HttpError(409, `Project is ${project.status}; only DRAFT projects can be edited`);
  }

  // Non-admins: the DRAFT check is repeated inside the UPDATE so a concurrent status change
  // cannot slip an edit through between the read above and this write.
  const { count } = await prisma.project.updateMany({
    where: isAdmin ? { id } : { id, status: 'DRAFT' },
    data: patch,
  });
  if (count === 0) throw new HttpError(409, 'Project is no longer in DRAFT; it cannot be edited');
  return toPublicProject(await prisma.project.findUniqueOrThrow({ where: { id } }));
}

export async function changeStatus(id: string, to: ProjectStatus, user: AuthUser) {
  const { project, isAdmin } = await loadManageableProject(id, user);
  const from = project.status;

  const rule = findTransition(from, to);
  if (!rule) {
    const next = allowedNextStatuses(from);
    throw new HttpError(
      409,
      `Invalid status transition ${from} -> ${to}` +
        (next.length ? `; allowed from ${from}: ${next.join(', ')}` : `; ${from} is a final status`),
      { from, to, allowed: next },
    );
  }
  if (rule.actor === 'ADMIN' && !isAdmin) {
    throw new HttpError(403, `Only an administrator can move a project ${from} -> ${to}`);
  }

  const data: Prisma.ProjectUpdateManyMutationInput = { status: to };
  if (from === 'DRAFT' && to === 'SUBMITTED') {
    const missing = missingForSubmission(project);
    if (missing.length) {
      throw new HttpError(422, `Project is incomplete; required before submitting: ${missing.join(', ')}`, {
        missing,
      });
    }
    data.submittedAt = new Date();
  }
  if (to === 'DRAFT') data.submittedAt = null; // withdrawn: no longer submitted

  // Compare-and-set on the current status: two concurrent transitions cannot both win.
  const { count } = await prisma.project.updateMany({ where: { id, status: from }, data });
  if (count === 0) throw new HttpError(409, 'Project status changed concurrently; reload and retry');
  return toPublicProject(await prisma.project.findUniqueOrThrow({ where: { id } }));
}

// ---- Collaborators -------------------------------------------------------------------------

export const COLLABORATOR_ROLES = ['RESEARCHER', 'STUDENT'] as const;

interface CollaboratorView {
  userId: string;
  fullName: string;
  email: string;
  userRole: string;
  role: CollaboratorRole;
  isOwner: boolean;
  addedAt: Date;
}

export async function listCollaborators(projectId: string, user: AuthUser): Promise<CollaboratorView[]> {
  const { project } = await loadVisibleProject(projectId, user);
  const [owner, rows] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: project.ownerId } }),
    prisma.projectCollaborator.findMany({
      where: { projectId },
      include: { user: true },
      orderBy: { addedAt: 'asc' },
    }),
  ]);
  return [
    // The owner is implicitly LEAD and has no row in project_collaborators.
    {
      userId: owner.id,
      fullName: owner.fullName,
      email: owner.email,
      userRole: owner.role,
      role: 'LEAD',
      isOwner: true,
      addedAt: project.createdAt,
    },
    ...rows.map((c) => ({
      userId: c.userId,
      fullName: c.user.fullName,
      email: c.user.email,
      userRole: c.user.role,
      role: c.role,
      isOwner: false,
      addedAt: c.addedAt,
    })),
  ];
}

export async function addCollaborator(projectId: string, input: AddCollaboratorInput, user: AuthUser) {
  const { project } = await loadManageableProject(projectId, user);

  if (input.userId === project.ownerId) {
    throw new HttpError(409, 'The project owner is already the lead and cannot be added as a collaborator');
  }
  const target = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!target || !target.isActive) throw new HttpError(404, 'User not found');
  if (!(COLLABORATOR_ROLES as readonly string[]).includes(target.role)) {
    throw new HttpError(422, `Only users with role ${COLLABORATOR_ROLES.join(' or ')} can be collaborators`);
  }

  try {
    await prisma.projectCollaborator.create({
      data: { projectId, userId: target.id, role: input.role },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'User is already a collaborator on this project');
    }
    throw err;
  }
  return listCollaborators(projectId, user);
}

export async function removeCollaborator(projectId: string, userId: string, user: AuthUser) {
  const { project } = await loadManageableProject(projectId, user);
  if (userId === project.ownerId) {
    throw new HttpError(409, 'The project owner cannot be removed');
  }
  const { count } = await prisma.projectCollaborator.deleteMany({ where: { projectId, userId } });
  if (count === 0) throw new HttpError(404, 'Collaborator not found');
}
