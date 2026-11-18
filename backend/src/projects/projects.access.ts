import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';
import { visibleProjectsWhere } from './projects.scope';

export interface ProjectAccess {
  project: { id: string; ownerId: string; title: string; status: Prisma.ProjectGetPayload<object>['status'] };
  isOwner: boolean;
  /** Collaborator whose permission is EDITOR. */
  isEditor: boolean;
  /** Collaborator whose permission is VIEWER. */
  isViewer: boolean;
  isAdmin: boolean;
  /** Owner, EDITOR collaborator or administrator: may change the project's content, documents and progress. */
  canEdit: boolean;
  /** Owner or administrator: may submit/withdraw, add or remove collaborators and change their permissions. */
  canManage: boolean;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Loads a project ONLY if the caller may see it (scoping is part of the WHERE clause: invisible and missing are both 404)
 * and says what the caller may do with it. The owner is the only non-administrator who controls collaborators and their
 * view/edit permission; an EDITOR collaborator can edit but never manage.
 */
export async function loadProjectAccess(projectId: string, user: AuthUser, db: Db = prisma): Promise<ProjectAccess> {
  const row = await db.project.findFirst({
    where: { AND: [{ id: projectId }, visibleProjectsWhere(user)] },
    select: {
      id: true,
      ownerId: true,
      title: true,
      status: true,
      collaborators: { where: { userId: user.id }, select: { role: true } },
    },
  });
  if (!row) throw new HttpError(404, 'Project not found');
  const { collaborators, ...project } = row;
  const isOwner = project.ownerId === user.id;
  const isEditor = collaborators.some((c) => c.role === 'EDITOR');
  const isViewer = !isEditor && collaborators.length > 0;
  const isAdmin = user.role === 'ADMINISTRATOR';
  return {
    project,
    isOwner,
    isEditor,
    isViewer,
    isAdmin,
    canEdit: isOwner || isEditor || isAdmin,
    canManage: isOwner || isAdmin,
  };
}

export async function loadEditableProject(projectId: string, user: AuthUser, db: Db = prisma) {
  const access = await loadProjectAccess(projectId, user, db);
  if (!access.canEdit) throw new HttpError(403, 'You only have view access to this project');
  return access;
}

export async function loadManageableProject(projectId: string, user: AuthUser, db: Db = prisma) {
  const access = await loadProjectAccess(projectId, user, db);
  if (!access.canManage) throw new HttpError(403, 'Only the project owner or an administrator can do this');
  return access;
}
