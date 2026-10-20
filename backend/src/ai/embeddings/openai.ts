import { assertValidEmbeddings, EMBEDDING_DIMENSIONS, EmbeddingError, type EmbeddingProvider } from './provider';

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  batchSize?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Client for any OpenAI-compatible `POST /v1/embeddings` endpoint. Batches inputs, applies a per-request
 * timeout, retries 429 / 5xx / network errors with exponential backoff (honouring Retry-After), and validates
 * every returned vector. The API key is only ever placed in the Authorization header; it is never logged,
 * and neither response bodies nor input texts are included in error messages.
 */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: OpenAIEmbeddingOptions) {
    if (!opts.apiKey) throw new EmbeddingError('EMBEDDING_API_KEY is required for the openai embedding provider');
    this.batchSize = Math.max(1, opts.batchSize ?? 64);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(...(await this.embedBatch(texts.slice(i, i + this.batchSize))));
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = { model: this.opts.model, input: batch, encoding_format: 'float' };
    // text-embedding-3-* can emit fewer dimensions natively; this pins the output to the DB column size.
    if (/^text-embedding-3/.test(this.opts.model)) body.dimensions = this.dimensions;

    for (let attempt = 0; ; attempt++) {
      let retryAfterMs: number | undefined;
      let failure: EmbeddingError;
      try {
        const res = await this.fetchImpl(this.opts.apiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return this.parse(await res.json(), batch.length);
        if (res.status !== 429 && res.status < 500) {
          // 4xx other than 429 (bad key, bad model, bad request) will not succeed on retry.
          throw new EmbeddingError(`Embedding API rejected the request (HTTP ${res.status})`, res.status);
        }
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, MAX_BACKOFF_MS);
        failure = new EmbeddingError(`Embedding API error (HTTP ${res.status})`, res.status);
      } catch (err) {
        if (err instanceof EmbeddingError) throw err; // permanent: 4xx or malformed response
        const name = (err as { name?: string } | null)?.name;
        failure = new EmbeddingError(
          name === 'TimeoutError' || name === 'AbortError' ? 'Embedding API request timed out' : 'Embedding API network error',
        );
      }
      if (attempt >= this.maxRetries) {
        throw new EmbeddingError(`${failure.message} - gave up after ${attempt + 1} attempts`, failure.status);
      }
      await this.sleep(retryAfterMs ?? Math.min(this.baseDelayMs * 2 ** attempt, MAX_BACKOFF_MS));
    }
  }

  private parse(json: unknown, expected: number): number[][] {
    const data = (json as { data?: { index?: number; embedding?: unknown }[] } | null)?.data;
    if (!Array.isArray(data)) throw new EmbeddingError('Embedding API returned an unexpected response shape');
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
    assertValidEmbeddings(ordered, expected, this.dimensions);
    return ordered;
  }
}
