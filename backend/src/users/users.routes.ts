import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authorize } from '../middleware/authorize';
import { createUserSchema, idParamSchema, listUsersQuerySchema, updateUserSchema } from './users.schemas';
import { createUser, getUser, listUsers, updateUser } from './users.service';

export const usersRouter = Router();

// Administration only.
usersRouter.post(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    res.status(201).json(await createUser(input));
  }),
);

// Declared before '/:id'; the two never overlap (this one has no path parameter).
usersRouter.get(
  '/',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    res.json(await listUsers(query));
  }),
);

usersRouter.put(
  '/:id',
  ...authorize({ roles: ['ADMINISTRATOR'] }),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const patch = updateUserSchema.parse(req.body);
    res.json(await updateUser(id, patch));
  }),
);

// Administrators, or a user reading their own record (ownership revalidated per request).
usersRouter.get(
  '/:id',
  ...authorize({
    roles: ['ADMINISTRATOR'],
    ownership: (req, user) => req.params.id === user.id,
  }),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await getUser(id));
  }),
);
