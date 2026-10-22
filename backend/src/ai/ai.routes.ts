import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import { ipRateLimit } from '../middleware/rateLimit';
import { askProject, askSchema, flagInteraction, interactionsQuerySchema, listInteractions, listMyInteractions } from './ask.service';

const idParam = z.object({ id: z.string().uuid() });
// Investors never reach project documents (BR-007), so they cannot use the assistant either.
const ASK_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE'] as const;

/** Mounted at /projects. */
export const projectAiRouter = Router();

projectAiRouter.post(
  '/:id/ask',
  ipRateLimit(60, 1),
  ...authorize({ roles: [...ASK_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await askProject(id, askSchema.parse(req.body), req.user!));
  }),
);

projectAiRouter.get(
  '/:id/ai-history',
  ...authorize({ roles: [...ASK_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await listMyInteractions(id, req.user!));
  }),
);

/** Mounted at /ai. */
export const aiRouter = Router();

aiRouter.get(
  '/interactions',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    res.json(await listInteractions(interactionsQuerySchema.parse(req.query)));
  }),
);

aiRouter.post(
  '/interactions/:id/flag',
  ...authorize({ roles: [...ASK_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await flagInteraction(id, req.user!));
  }),
);
