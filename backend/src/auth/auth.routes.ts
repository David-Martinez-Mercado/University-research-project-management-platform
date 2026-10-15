import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { ipRateLimit } from '../middleware/rateLimit';
import { getUser } from '../users/users.service';
import { bootstrapOwnerSchema, loginSchema } from './auth.schemas';
import { bootstrapOwner, login } from './auth.service';

export const authRouter = Router();

authRouter.post(
  '/login',
  ipRateLimit(30, 15),
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    res.json(await login(email, password));
  }),
);

authRouter.post(
  '/bootstrap-owner',
  ipRateLimit(10, 15),
  asyncHandler(async (req, res) => {
    const input = bootstrapOwnerSchema.parse(req.body);
    const user = await bootstrapOwner(input, req.header('x-bootstrap-secret'));
    res.status(201).json(user);
  }),
);

// Current user; also handy for the frontend to validate a stored token.
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await getUser(req.user!.id));
  }),
);
