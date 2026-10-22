import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import { getMyEvaluation, getResults, saveEvaluationSchema, saveEvaluation } from './evaluations.service';

const idParam = z.object({ id: z.string().uuid() });

/** Mounted at /evaluations. */
export const evaluationsRouter = Router();

evaluationsRouter.post(
  '/',
  ...authorize({ roles: ['JUDGE'] }),
  asyncHandler(async (req, res) => {
    const input = saveEvaluationSchema.parse(req.body);
    res.status(input.submit ? 201 : 200).json(await saveEvaluation(input, req.user!));
  }),
);

/** Mounted at /projects. */
export const projectEvaluationRouter = Router();

projectEvaluationRouter.get(
  '/:id/evaluation',
  ...authorize({ roles: ['JUDGE'] }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await getMyEvaluation(id, req.user!));
  }),
);

projectEvaluationRouter.get(
  '/:id/results',
  ...authorize({ roles: ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE', 'INVESTOR'] }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await getResults(id, req.user!));
  }),
);
