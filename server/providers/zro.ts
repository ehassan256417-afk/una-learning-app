import { ProviderError, type AiProvider, type LessonRequest } from './types.ts';

/**
 * ZRO (https://zro.moonmath.ai) via its Chat Completions API.
 *
 * Documented at https://zro.moonmath.ai/docs/api:
 *   POST https://zro.moonmath.ai/v1/chat/completions
 *   Authorization: Bearer sk-...
 *
 * The API key is read from the server environment and sent in the
 * Authorization header. It never appears in a URL, a log line or any response
 * body, and this module is never imported by browser code.
 */

export type ZroReasoningEffort = 'none' | 'low' | 'high' | 'max';

export interface ZroOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Reasoning levels listed for deepseek-v4.1-flash. Kept low so reasoning does not crowd out the answer. */
  reasoningEffort?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** The model ZRO recommends, and the one its free daily usage applies to. */
export const DEFAULT_ZRO_MODEL = 'deepseek-v4.1-flash';
export const DEFAULT_ZRO_BASE_URL = 'https://zro.moonmath.ai/v1';
export const DEFAULT_ZRO_MAX_TOKENS = 16_000;
const REASONING_LEVELS: readonly string[] = ['none', 'low', 'high', 'max'];

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
}

export class ZroProvider implements AiProvider {
  readonly id = 'zro';
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private reasoningEffort: ZroReasoningEffort;
  private maxTokens: number;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: ZroOptions) {
    if (!options.apiKey) throw new ProviderError('not_configured', 'ZRO_API_KEY is not set on the server.');
    const effort = (options.reasoningEffort || 'low').toLowerCase();
    if (!REASONING_LEVELS.includes(effort)) {
      throw new ProviderError('not_configured', 'ZRO_REASONING_EFFORT must be one of: none, low, high, max.');
    }
    const baseUrl = (options.baseUrl || DEFAULT_ZRO_BASE_URL).replace(/\/$/, '');
    // The key must only ever travel over TLS (plain http is allowed for a local test double).
    if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) {
      throw new ProviderError('not_configured', 'The ZRO base URL must use https.');
    }
    this.apiKey = options.apiKey;
    this.model = options.model || DEFAULT_ZRO_MODEL;
    this.baseUrl = baseUrl;
    this.reasoningEffort = effort as ZroReasoningEffort;
    this.maxTokens = options.maxTokens && options.maxTokens > 0 ? Math.floor(options.maxTokens) : DEFAULT_ZRO_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: LessonRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          temperature: 0.2,
          max_tokens: this.maxTokens,
          reasoning_effort: this.reasoningEffort,
          response_format: { type: 'json_object' },
          stream: false,
        }),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new ProviderError('failed', timedOut ? 'The AI provider took too long to respond.' : 'Could not reach the AI provider.');
    } finally {
      clearTimeout(timer);
    }

    // Status meanings are from the ZRO API reference. The provider's error body
    // is never forwarded: it can echo request details.
    if (response.status === 429) {
      throw new ProviderError('rate_limited', 'The AI provider is rate-limiting requests. Try again in a few minutes.');
    }
    if (response.status === 402) {
      throw new ProviderError('rate_limited', 'The AI usage budget is used up for now. Try again later.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('not_configured', 'The AI provider rejected the server credentials.');
    }
    if (response.status === 404) {
      throw new ProviderError('not_configured', 'The configured AI model is not available from the provider.');
    }
    if (!response.ok) {
      throw new ProviderError('failed', `The AI provider returned an error (HTTP ${response.status}).`);
    }

    const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!text.trim()) {
      throw new ProviderError('failed', `The AI provider returned no content (${choice?.finish_reason || 'empty response'}).`);
    }
    if (choice?.finish_reason === 'length') {
      throw new ProviderError('failed', 'The AI response was cut off. Try a shorter PDF.');
    }
    return text;
  }
}
