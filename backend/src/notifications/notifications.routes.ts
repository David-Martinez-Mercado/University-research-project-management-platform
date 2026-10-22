import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import { listNotifications, markAllRead, markRead } from './notifications.service';

export const notificationsRouter = Router();

const ALL_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE', 'INVESTOR'] as const;

const listQuery = z.object({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, 100)),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const idParam = z.object({ id: z.string().uuid() });

notificationsRouter.get(
  '/',
  ...authorize({ roles: [...ALL_ROLES] }),
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await listNotifications(req.user!, { unreadOnly: q.unread, limit: q.limit, offset: q.offset }));
  }),
);

// Registered before '/:id/read' so "read-all" is never parsed as an id.
notificationsRouter.put(
  '/read-all',
  ...authorize({ roles: [...ALL_ROLES] }),
  asyncHandler(async (req, res) => {
    res.json(await markAllRead(req.user!));
  }),
);

notificationsRouter.put(
  '/:id/read',
  ...authorize({ roles: [...ALL_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await markRead(id, req.user!));
  }),
);
