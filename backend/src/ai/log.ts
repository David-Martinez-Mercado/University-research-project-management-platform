/**
 * Minimal logger for the AI module. Rules: never log API keys, document text or embeddings; only ids,
 * counts and short reason strings. Silent under vitest unless AI_LOG=1 (failure tests are noisy on purpose).
 */
const silent = () => process.env.NODE_ENV === 'test' && process.env.AI_LOG !== '1';

export const aiLog = {
  info(message: string, meta?: Record<string, unknown>): void {
    if (!silent()) console.log(`[ai] ${message}`, meta ?? '');
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (!silent()) console.warn(`[ai] ${message}`, meta ?? '');
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (!silent()) console.error(`[ai] ${message}`, meta ?? '');
  },
};
