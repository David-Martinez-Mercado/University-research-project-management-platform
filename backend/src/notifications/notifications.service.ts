import type { NotificationType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors';
import type { AuthUser } from '../middleware/authenticate';

export interface NotificationInput {
  projectId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
}

/**
 * In-app notifications (FR-019). Creating one must NEVER make the caller's request fail (NFR-004), so
 * failures are logged (ids only) and swallowed.
 */
export async function notifyUsers(userIds: string[], input: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        projectId: input.projectId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
      })),
    });
  } catch (err) {
    console.error('[notifications] could not create notifications', { reason: (err as Error)?.name });
  }
}

/** Owner + every collaborator of a project, optionally excluding the user who caused the event. */
export async function projectTeamIds(projectId: string, exceptUserId?: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, collaborators: { select: { userId: true } } },
  });
  if (!project) return [];
  return [project.ownerId, ...project.collaborators.map((c) => c.userId)].filter((id) => id !== exceptUserId);
}

export async function activeAdminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMINISTRATOR', isActive: true },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

export function toPublicNotification(n: {
  id: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}) {
  return {
    id: n.id,
    projectId: n.projectId,
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}

export async function listNotifications(
  user: AuthUser,
  query: { unreadOnly: boolean; limit: number; offset: number },
) {
  const where = { userId: user.id, ...(query.unreadOnly ? { isRead: false } : {}) };
  const [rows, total, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);
  return { data: rows.map(toPublicNotification), total, unread, limit: query.limit, offset: query.offset };
}

export async function markRead(id: string, user: AuthUser) {
  // Scoped by userId in the WHERE: another user's notification is indistinguishable from a missing one.
  const result = await prisma.notification.updateMany({
    where: { id, userId: user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!exists) throw new HttpError(404, 'Notification not found');
  }
  const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
  return toPublicNotification(row);
}

export async function markAllRead(user: AuthUser): Promise<{ updated: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}
