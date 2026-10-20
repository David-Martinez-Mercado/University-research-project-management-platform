import { recoverPendingIngestions, registerAiListeners } from './ai';
import { app } from './app';
import { env } from './config/env';
import { prisma } from './db/prisma';

// Uploaded documents are chunked + embedded in the background (see docs/AI_RAG.md).
registerAiListeners();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Re-run documents a previous process left unindexed (background; never blocks startup).
void recoverPendingIngestions();

const shutdown = () => {
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
