import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import {
  createCriterionSchema,
  criterionIdParamSchema,
  listCriteriaQuerySchema,
  projectIdParamSchema,
  updateCriterionSchema,
} from './criteria.schemas';
import { createCriterion, getProjectRubric, listCriteria, updateCriterion } from './criteria.service';

/** Mounted at `/criteria`. */
export const criteriaRouter = Router();

criteriaRouter.get(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR', 'JUDGE'] }),
  asyncHandler(async (req, res) => {
    const query = listCriteriaQuerySchema.parse(req.query);
    // Only administrators may see deactivated criteria; for judges the flag is ignored.
    const includeInactive = query.includeInactive && req.user!.role === 'ADMINISTRATOR';
    res.json({ data: await listCriteria(includeInactive) });
  }),
);

criteriaRouter.post(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const input = createCriterionSchema.parse(req.body);
    res.status(201).json(await createCriterion(input, req.user!));
  }),
);

criteriaRouter.put(
  '/:id',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const { id } = criterionIdParamSchema.parse(req.params);
    const patch = updateCriterionSchema.parse(req.body);
    res.json(await updateCriterion(id, patch));
  }),
);

/** Mounted at `/projects` (path `/:id/rubric`). INVESTOR is not allowed. */
export const rubricRouter = Router();

rubricRouter.get(
  '/:id/rubric',
  ...authorize({ roles: ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE'] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    res.json(await getProjectRubric(id, req.user!));
  }),
);
