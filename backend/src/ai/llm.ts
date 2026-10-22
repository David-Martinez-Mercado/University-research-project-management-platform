import { env } from '../config/env';

export interface Passage {
  fileName: string;
  content: string;
}

export interface LlmAnswer {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface LlmProvider {
  answer(question: string, passages: Passage[]): Promise<LlmAnswer>;
}

/** Any LLM failure (outage, timeout, quota, bad response). The message never contains the API key or the prompt. */
export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

const SYSTEM_PROMPT =
  'Eres el asistente de una plataforma universitaria de proyectos de investigación. Responde SOLO con la información ' +
  'de los fragmentos entregados, en español, de forma breve y clara. Si los fragmentos no contienen la respuesta, ' +
  'di exactamente: "No encontré información suficiente en los documentos del proyecto." No inventes datos.';

/** Offline provider: quotes the best passages. Not generative, but grounded by construction. */
export class MockLlmProvider implements LlmProvider {
  async answer(_question: string, passages: Passage[]): Promise<LlmAnswer> {
    const top = passages.slice(0, 2).map((p) => `«${p.content.trim().replace(/\s+/g, ' ').slice(0, 400)}»`);
    return { text: `Según los documentos del proyecto: ${top.join(' ')}`, model: 'mock-extractive' };
  }
}

/** Chat-completions API (OpenAI-compatible). */
export class OpenAICompatibleLlmProvider implements LlmProvider {
  constructor(
    private readonly cfg: { apiKey: string; apiUrl: string; model: string; timeoutMs: number },
  ) {}

  async answer(question: string, passages: Passage[]): Promise<LlmAnswer> {
    const context = passages.map((p, i) => `[${i + 1}] (${p.fileName})\n${p.content}`).join('\n\n');
    let res: Response;
    try {
      res = await fetch(this.cfg.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Fragmentos:\n${context}\n\nPregunta: ${question}` },
          ],
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new LlmError(`LLM request failed: ${(err as Error)?.name ?? 'error'}`);
    }
    if (!res.ok) throw new LlmError(`LLM provider answered ${res.status}`, res.status);
    const body = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LlmError('LLM provider returned an empty answer');
    return {
      text,
      model: this.cfg.model,
      promptTokens: body?.usage?.prompt_tokens,
      completionTokens: body?.usage?.completion_tokens,
    };
  }
}

let provider: LlmProvider | undefined;

export function getLlmProvider(): LlmProvider {
  if (!provider) {
    provider =
      env.LLM_PROVIDER === 'openai'
        ? new OpenAICompatibleLlmProvider({
            apiKey: env.LLM_API_KEY as string,
            apiUrl: env.LLM_API_URL,
            model: env.LLM_MODEL,
            timeoutMs: env.LLM_TIMEOUT_MS,
          })
        : new MockLlmProvider();
  }
  return provider;
}

/** Tests may inject a provider (pass undefined to reset to the env-configured one). */
export function setLlmProviderForTests(impl: LlmProvider | undefined): void {
  provider = impl;
}
