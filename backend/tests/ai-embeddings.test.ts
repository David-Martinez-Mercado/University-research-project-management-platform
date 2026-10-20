import { describe, expect, it, vi } from 'vitest';
import {
  assertValidEmbeddings,
  createEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  MockEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
} from '../src/ai/embeddings';
import { tokenize } from '../src/ai/embeddings/mock';
import { toVectorLiteral } from '../src/ai/vector';

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const norm = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));

describe('MockEmbeddingProvider', () => {
  const mock = new MockEmbeddingProvider();

  it('produces 1536-dimension, L2-normalised, finite vectors', async () => {
    const [v] = await mock.embed(['Investigación sobre sensores cuánticos']);
    expect(mock.dimensions).toBe(1536);
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(norm(v!)).toBeCloseTo(1, 6);
    expect(v!.every(Number.isFinite)).toBe(true);
  });

  it('is deterministic: identical text gives identical vectors, across instances and calls', async () => {
    const [a, b] = await mock.embed(['same text here', 'same text here']);
    const [c] = await new MockEmbeddingProvider().embed(['same text here']);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('keeps input order and returns one vector per text (including empty list)', async () => {
    expect(await mock.embed([])).toEqual([]);
    const out = await mock.embed(['alpha', 'beta', 'gamma']);
    expect(out).toHaveLength(3);
    expect(out[0]).not.toEqual(out[1]);
  });

  it('gives higher cosine similarity to texts that share words', async () => {
    const [q, related, unrelated] = await mock.embed([
      'quantum sensor calibration procedure',
      'the calibration procedure of the quantum sensor was repeated twice',
      'budget for catering and office furniture next year',
    ]);
    expect(cosine(q!, related!)).toBeGreaterThan(0.4);
    expect(cosine(q!, unrelated!)).toBeLessThan(0.1);
    expect(cosine(q!, related!)).toBeGreaterThan(cosine(q!, unrelated!) + 0.3);
  });

  it('ignores case, accents and punctuation', async () => {
    const [a, b] = await mock.embed(['Investigación, CUÁNTICA!', 'investigacion cuantica']);
    expect(a).toEqual(b);
    expect(tokenize('Ñandú—fácil')).toEqual(['nandu', 'facil']);
  });

  it('never returns a zero vector (punctuation-only / empty input)', async () => {
    for (const t of ['', '   ', '!!!', '???']) {
      const [v] = await mock.embed([t]);
      expect(norm(v!)).toBeCloseTo(1, 6);
    }
  });
});

describe('toVectorLiteral / assertValidEmbeddings', () => {
  it('serialises to a pgvector literal and enforces dimensions and finiteness', () => {
    const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    v[0] = 0.1;
    v[1] = -2.5e-7;
    const lit = toVectorLiteral(v);
    expect(lit.startsWith('[0.1,-2.5e-7,0,')).toBe(true);
    expect(lit.split(',')).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(() => toVectorLiteral([1, 2, 3])).toThrow(/dimensions/);
    expect(() => toVectorLiteral(v.map((x, i) => (i === 5 ? NaN : x)))).toThrow(/non-finite/);
  });

  it('assertValidEmbeddings reports count, dimension and value problems', () => {
    const ok = [new Array<number>(4).fill(0.5)];
    expect(() => assertValidEmbeddings(ok, 1, 4)).not.toThrow();
    expect(() => assertValidEmbeddings(ok, 2, 4)).toThrow(EmbeddingError);
    expect(() => assertValidEmbeddings(ok, 1, 5)).toThrow(/expected 5/);
    expect(() => assertValidEmbeddings([[1, Infinity, 1, 1]], 1, 4)).toThrow(/non-finite/);
    expect(() => assertValidEmbeddings(null, 1, 4)).toThrow(EmbeddingError);
  });
});

// ───────────────────── OpenAI-compatible provider (fetch is mocked; no network) ─────────────────────

const vec = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => ((i + seed) % 7) / 7);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Fake OpenAI server: answers with one vector per input, tagged by the input's index in the original list. */
function okEcho(res = (inputs: string[]) => inputs.map((t, i) => ({ index: i, embedding: vec(t.length) }))) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return jsonResponse({ data: res(body.input) });
  });
}

function provider(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof OpenAICompatibleEmbeddingProvider>[0]> = {}) {
  const sleeps: number[] = [];
  const p = new OpenAICompatibleEmbeddingProvider({
    apiKey: 'sk-test-SECRET-KEY',
    apiUrl: 'https://api.example.test/v1/embeddings',
    model: 'text-embedding-3-small',
    batchSize: 3,
    sleep: async (ms) => void sleeps.push(ms),
    baseDelayMs: 100,
    fetchImpl,
    ...extra,
  });
  return { p, sleeps };
}

describe('OpenAICompatibleEmbeddingProvider', () => {
  it('sends model, input, dimensions and the bearer key; returns vectors in input order', async () => {
    const fetchMock = okEcho();
    const { p } = provider(fetchMock as unknown as typeof fetch);
    const out = await p.embed(['a', 'bb']);
    expect(out).toEqual([vec(1), vec(2)]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/v1/embeddings');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test-SECRET-KEY');
    expect(JSON.parse(String(init!.body))).toEqual({
      model: 'text-embedding-3-small',
      input: ['a', 'bb'],
      encoding_format: 'float',
      dimensions: 1536,
    });
  });

  it('does not send `dimensions` for non text-embedding-3 models', async () => {
    const fetchMock = okEcho();
    const { p } = provider(fetchMock as unknown as typeof fetch, { model: 'some-local-model' });
    await p.embed(['x']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).not.toHaveProperty('dimensions');
  });

  it('splits inputs into batches and preserves overall order', async () => {
    const fetchMock = okEcho();
    const { p } = provider(fetchMock as unknown as typeof fetch);
    const texts = ['1', '22', '333', '4444', '55555', '666666', '7777777']; // batchSize 3 -> 3 calls
    const out = await p.embed(texts);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]!.body)).input.length)).toEqual([3, 3, 1]);
    expect(out).toEqual(texts.map((t) => vec(t.length)));
  });

  it('reorders by the `index` field when the API returns items out of order', async () => {
    const fetchMock = okEcho((inputs) => inputs.map((t, i) => ({ index: i, embedding: vec(t.length) })).reverse());
    const { p } = provider(fetchMock as unknown as typeof fetch);
    expect(await p.embed(['a', 'bb', 'ccc'])).toEqual([vec(1), vec(2), vec(3)]);
  });

  it('makes no request for an empty input list', async () => {
    const fetchMock = okEcho();
    const { p } = provider(fetchMock as unknown as typeof fetch);
    expect(await p.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: [{ index: 0, embedding: vec(0) }] }));
    const { p, sleeps } = provider(fetchMock as unknown as typeof fetch);
    expect(await p.embed(['x'])).toEqual([vec(0)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('honours Retry-After on 429', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ index: 0, embedding: vec(0) }] }));
    const { p, sleeps } = provider(fetchMock as unknown as typeof fetch);
    await p.embed(['x']);
    expect(sleeps).toEqual([2000]);
  });

  it('retries network errors and timeouts', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse({ data: [{ index: 0, embedding: vec(0) }] }));
    const { p } = provider(fetchMock as unknown as typeof fetch);
    expect(await p.embed(['x'])).toEqual([vec(0)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries with a clear message', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'down' }, 500));
    const { p, sleeps } = provider(fetchMock as unknown as typeof fetch, { maxRetries: 2 });
    await expect(p.embed(['x'])).rejects.toThrow(/HTTP 500.*gave up after 3 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does NOT retry a 401 and never leaks the key or response body in the error', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Incorrect API key provided: sk-test-SECRET-KEY' } }, 401),
    );
    const { p, sleeps } = provider(fetchMock as unknown as typeof fetch);
    const err = await p.embed(['x']).then(
      () => undefined,
      (e: unknown) => e as EmbeddingError,
    );
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err!.status).toBe(401);
    expect(err!.message).toMatch(/HTTP 401/);
    expect(err!.message).not.toContain('SECRET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('fails clearly when a returned vector has the wrong dimension (not retried)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: new Array(3072).fill(0.1) }] }));
    const { p } = provider(fetchMock as unknown as typeof fetch);
    await expect(p.embed(['x'])).rejects.toThrow(/3072 dimensions, expected 1536/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails when the API returns fewer vectors than inputs, a bad shape, or non-finite numbers', async () => {
    const few = provider(vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: vec(0) }] })) as unknown as typeof fetch).p;
    await expect(few.embed(['a', 'b'])).rejects.toThrow(/1 vectors for 2 inputs/);
    const shape = provider(vi.fn(async () => jsonResponse({ nope: true })) as unknown as typeof fetch).p;
    await expect(shape.embed(['a'])).rejects.toThrow(/unexpected response shape/);
    const bad = vec(0);
    bad[3] = null as unknown as number; // JSON has no NaN: null is what a broken server would send
    const nan = provider(vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: bad }] })) as unknown as typeof fetch).p;
    await expect(nan.embed(['a'])).rejects.toThrow(/non-finite/);
  });

  it('requires an API key', () => {
    expect(() => new OpenAICompatibleEmbeddingProvider({ apiKey: '', apiUrl: 'https://x.test', model: 'm' })).toThrow(/EMBEDDING_API_KEY/);
  });
});

describe('createEmbeddingProvider (factory)', () => {
  const base = {
    EMBEDDING_API_URL: 'https://api.example.test/v1/embeddings',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_BATCH_SIZE: 64,
    EMBEDDING_TIMEOUT_MS: 1000,
  };

  it('returns the mock provider by default and the OpenAI-compatible one when configured', () => {
    expect(createEmbeddingProvider({ ...base, EMBEDDING_PROVIDER: 'mock' })).toBeInstanceOf(MockEmbeddingProvider);
    expect(createEmbeddingProvider({ ...base, EMBEDDING_PROVIDER: 'openai', EMBEDDING_API_KEY: 'k' })).toBeInstanceOf(
      OpenAICompatibleEmbeddingProvider,
    );
  });

  it('refuses openai without a key', () => {
    expect(() => createEmbeddingProvider({ ...base, EMBEDDING_PROVIDER: 'openai' })).toThrow(/EMBEDDING_API_KEY/);
  });
});

describe('startup configuration (env.ts)', () => {
  async function loadEnv(overrides: Record<string, string | undefined>) {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(overrides)) {
      saved[k] = process.env[k];
      if (overrides[k] === undefined) delete process.env[k];
      else process.env[k] = overrides[k];
    }
    vi.resetModules();
    try {
      return await import('../src/config/env');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.resetModules();
    }
  }

  it('defaults to the mock provider', async () => {
    const { env } = await loadEnv({ EMBEDDING_PROVIDER: undefined });
    expect(env.EMBEDDING_PROVIDER).toBe('mock');
    expect(env.EMBEDDING_MODEL).toBe('text-embedding-3-small');
  });

  it('fails at startup with a clear message when EMBEDDING_PROVIDER=openai has no key', async () => {
    await expect(loadEnv({ EMBEDDING_PROVIDER: 'openai', EMBEDDING_API_KEY: '' })).rejects.toThrow(
      /EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai/,
    );
    await expect(loadEnv({ EMBEDDING_PROVIDER: 'openai', EMBEDDING_API_KEY: undefined })).rejects.toThrow(/EMBEDDING_API_KEY/);
  });

  it('accepts openai with a key and rejects unknown providers', async () => {
    const { env } = await loadEnv({ EMBEDDING_PROVIDER: 'openai', EMBEDDING_API_KEY: 'k' });
    expect(env.EMBEDDING_PROVIDER).toBe('openai');
    await expect(loadEnv({ EMBEDDING_PROVIDER: 'cohere' })).rejects.toThrow(/EMBEDDING_PROVIDER/);
  });
});
