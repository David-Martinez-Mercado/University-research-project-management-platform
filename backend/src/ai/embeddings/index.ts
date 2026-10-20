import { env } from '../../config/env';
import { MockEmbeddingProvider } from './mock';
import { OpenAICompatibleEmbeddingProvider } from './openai';
import { EmbeddingError, type EmbeddingProvider } from './provider';

export { EMBEDDING_DIMENSIONS, EmbeddingError, assertValidEmbeddings } from './provider';
export type { EmbeddingProvider } from './provider';
export { MockEmbeddingProvider } from './mock';
export { OpenAICompatibleEmbeddingProvider } from './openai';

export interface EmbeddingConfig {
  EMBEDDING_PROVIDER: 'mock' | 'openai';
  EMBEDDING_API_KEY?: string | undefined;
  EMBEDDING_API_URL: string;
  EMBEDDING_MODEL: string;
  EMBEDDING_BATCH_SIZE: number;
  EMBEDDING_TIMEOUT_MS: number;
}

export function createEmbeddingProvider(cfg: EmbeddingConfig = env): EmbeddingProvider {
  switch (cfg.EMBEDDING_PROVIDER) {
    case 'mock':
      return new MockEmbeddingProvider();
    case 'openai':
      if (!cfg.EMBEDDING_API_KEY) throw new EmbeddingError('EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai');
      return new OpenAICompatibleEmbeddingProvider({
        apiKey: cfg.EMBEDDING_API_KEY,
        apiUrl: cfg.EMBEDDING_API_URL,
        model: cfg.EMBEDDING_MODEL,
        batchSize: cfg.EMBEDDING_BATCH_SIZE,
        timeoutMs: cfg.EMBEDDING_TIMEOUT_MS,
      });
  }
}

let provider: EmbeddingProvider | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  provider ??= createEmbeddingProvider();
  return provider;
}

/** Tests may inject a provider (pass undefined to reset to the env-configured one). */
export function setEmbeddingProviderForTests(impl: EmbeddingProvider | undefined): void {
  provider = impl;
}
