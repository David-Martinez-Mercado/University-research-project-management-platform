import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import {
  addCollaboratorSchema,
  changeStatusSchema,
  collaboratorParamsSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  updateProjectSchema,
} from './projects.schemas';
import {
  addCollaborator,
  changeStatus,
  createProject,
  getProject,
  listCollaborators,
  listProjects,
  removeCollaborator,
  updateProject,
} from './projects.service';

export const projectsRouter = Router();

// Role gate only decides "may this ROLE ever use the endpoint". Which concrete project a caller
// may see / manage is decided in the service, inside the database query (see projects.scope.ts).
// `req.user` is always set here: authorize() runs authenticate first and denies by default.
const ALL_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT', 'JUDGE', 'INVESTOR'] as const;
const PROJECT_TEAM_ROLES = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT'] as const;

projectsRouter.post(
  '/',
  ...authorize({ roles: ['RESEARCHER', 'ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const input = createProjectSchema.parse(req.body);
    res.status(201).json(await createProject(input, req.user!));
  }),
);

projectsRouter.get(
  '/',
  ...authorize({ roles: [...ALL_ROLES] }),
  asyncHandler(async (req, res) => {
    const query = listProjectsQuerySchema.parse(req.query);
    res.json(await listProjects(query, req.user!));
  }),
);

projectsRouter.get(
  '/:id',
  ...authorize({ roles: [...ALL_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    res.json(await getProject(id, req.user!));
  }),
);

projectsRouter.put(
  '/:id',
  ...authorize({ roles: [...PROJECT_TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    const patch = updateProjectSchema.parse(req.body);
    res.json(await updateProject(id, patch, req.user!));
  }),
);

projectsRouter.put(
  '/:id/status',
  ...authorize({ roles: [...PROJECT_TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    const { status } = changeStatusSchema.parse(req.body);
    res.json(await changeStatus(id, status, req.user!));
  }),
);

projectsRouter.get(
  '/:id/collaborators',
  ...authorize({ roles: [...PROJECT_TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    res.json({ data: await listCollaborators(id, req.user!) });
  }),
);

projectsRouter.post(
  '/:id/collaborators',
  ...authorize({ roles: [...PROJECT_TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id } = projectIdParamSchema.parse(req.params);
    const input = addCollaboratorSchema.parse(req.body);
    res.status(201).json({ data: await addCollaborator(id, input, req.user!) });
  }),
);

projectsRouter.delete(
  '/:id/collaborators/:userId',
  ...authorize({ roles: [...PROJECT_TEAM_ROLES] }),
  asyncHandler(async (req, res) => {
    const { id, userId } = collaboratorParamsSchema.parse(req.params);
    await removeCollaborator(id, userId, req.user!);
    res.status(204).end();
  }),
);
