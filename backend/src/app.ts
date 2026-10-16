import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authRouter } from './auth/auth.routes';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { projectsRouter } from './projects/projects.routes';
import { usersRouter } from './users/users.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Render (and most hosts) terminate TLS in a proxy; needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      // Lets the browser frontend read the refreshed token (sliding inactivity window).
      exposedHeaders: ['X-Auth-Token', 'Retry-After'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/projects', projectsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
