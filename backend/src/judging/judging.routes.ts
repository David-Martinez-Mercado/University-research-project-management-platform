import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import {
  createAssignmentSchema,
  idParamSchema,
  judgeProjectsQuerySchema,
  listAssignmentsQuerySchema,
} from './judging.schemas';
import { createAssignment, deleteAssignment, listAssignments, listJudgeProjects } from './judging.service';

/** Mounted at `/judge-assignments`. Administrators only. */
export const judgeAssignmentsRouter = Router();

judgeAssignmentsRouter.post(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const input = createAssignmentSchema.parse(req.body);
    res.status(201).json(await createAssignment(input, req.user!));
  }),
);

judgeAssignmentsRouter.get(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const query = listAssignmentsQuerySchema.parse(req.query);
    res.json(await listAssignments(query));
  }),
);

judgeAssignmentsRouter.delete(
  '/:id',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await deleteAssignment(id);
    res.status(204).end();
  }),
);

/** Mounted at `/judges`. */
export const judgesRouter = Router();

// Administrators, or a JUDGE reading their own assignments (ownership revalidated per request).
judgesRouter.get(
  '/:id/projects',
  ...authorize({
    roles: ['ADMINISTRATOR'],
    ownership: (req, user) => user.role === 'JUDGE' && req.params.id === user.id,
  }),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const query = judgeProjectsQuerySchema.parse(req.query);
    res.json(await listJudgeProjects(id, query, req.user!));
  }),
);
