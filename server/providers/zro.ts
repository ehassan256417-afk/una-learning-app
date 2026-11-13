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
  /** Reasoning levels listed for deepseek-v4.1-flash: none, low, high, max. Defaults to none. */
  reasoningEffort?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** The model ZRO recommends, and the one its free daily usage applies to. */
export const DEFAULT_ZRO_MODEL = 'deepseek-v4.1-flash';
export const DEFAULT_ZRO_BASE_URL = 'https://zro.moonmath.ai/v1';
/**
 * Reasoning tokens are billed as output and count against `max_tokens`. With
 * reasoning on, a 7-page PDF spent the whole 16,000-token allowance thinking
 * and returned no lesson (finish_reason "length", empty content). Reasoning is
 * therefore off by default, and the allowance leaves room for a full lesson
 * (about 4,500 tokens for a 3-page document; the model's limit is 64,000).
 */
export const DEFAULT_ZRO_REASONING_EFFORT: ZroReasoningEffort = 'none';
export const DEFAULT_ZRO_MAX_TOKENS = 32_000;
const REASONING_LEVELS: readonly string[] = ['none', 'low', 'high', 'max'];

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
  usage?: RawUsage;
}

interface ChatCompletionChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: { content?: string | null };
  }>;
  usage?: RawUsage | null;
  error?: unknown;
}

interface Completion {
  text: string;
  finishReason?: string;
  usage?: RawUsage;
}

/**
 * Reads a server-sent-events stream of chat completion chunks.
 * A stream that reports an error, or ends before the model said it was done,
 * is rejected so a half-written lesson is never passed on.
 */
async function readStream(body: ReadableStream<Uint8Array>): Promise<Completion> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let text = '';
  let finishReason: string | undefined;
  let usage: RawUsage | undefined;
  let done = false;

  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data) as ChatCompletionChunk;
    } catch {
      return; // Ignore a malformed event; a truncated answer is caught below.
    }
    if (chunk.error) throw new ProviderError('failed', 'The AI provider reported an error while writing the lesson.');
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };

  for (;;) {
    const { value, done: ended } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      handle(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
    }
    if (ended) break;
  }
  handle(buffer.trim());

  if (!finishReason && !done) {
    throw new ProviderError('failed', 'The AI response ended before it was complete. Try again.');
  }
  return { text, finishReason, usage };
}

export class ZroProvider implements AiProvider {
  readonly id = 'zro';
  readonly model: string;
  /** A true private field, so the key is left out if the provider object is ever logged or serialized. */
  #apiKey: string;
  private baseUrl: string;
  private reasoningEffort: ZroReasoningEffort;
  private maxTokens: number;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: ZroOptions) {
    if (!options.apiKey) throw new ProviderError('not_configured', 'ZRO_API_KEY is not set on the server.');
    const effort = (options.reasoningEffort || DEFAULT_ZRO_REASONING_EFFORT).toLowerCase();
    if (!REASONING_LEVELS.includes(effort)) {
      throw new ProviderError('not_configured', 'ZRO_REASONING_EFFORT must be one of: none, low, high, max.');
    }
    const baseUrl = (options.baseUrl || DEFAULT_ZRO_BASE_URL).replace(/\/$/, '');
    // The key must only ever travel over TLS (plain http is allowed for a local test double).
    if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) {
      throw new ProviderError('not_configured', 'The ZRO base URL must use https.');
    }
    this.#apiKey = options.apiKey;
    this.model = options.model || DEFAULT_ZRO_MODEL;
    this.baseUrl = baseUrl;
    this.reasoningEffort = effort as ZroReasoningEffort;
    this.maxTokens = options.maxTokens && options.maxTokens > 0 ? Math.floor(options.maxTokens) : DEFAULT_ZRO_MAX_TOKENS;
    // Covers the whole streamed answer, not just the first byte.
    this.timeoutMs = options.timeoutMs ?? 240_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: LessonRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.#request(request, controller.signal);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const timedOut = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      throw new ProviderError('failed', timedOut ? 'The AI provider took too long to respond.' : 'Could not reach the AI provider.');
    } finally {
      clearTimeout(timer);
    }
  }

  async #request(request: LessonRequest, signal: AbortSignal): Promise<string> {
    // The answer is streamed: a long lesson sent as one non-streamed response
    // can outlast the provider's proxy timeout (seen as HTTP 524).
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        temperature: 0.2,
        max_tokens: request.maxTokens ? Math.min(request.maxTokens, this.maxTokens) : this.maxTokens,
        reasoning_effort: this.reasoningEffort,
        response_format: { type: 'json_object' },
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

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

    const completion = await this.#readCompletion(response);
    // Reported before the answer is judged, so a rejected answer still counts against the budget.
    if (request.onUsage) {
      const reported = completion.usage;
      request.onUsage(
        typeof reported?.prompt_tokens === 'number' && typeof reported.completion_tokens === 'number'
          ? { promptTokens: reported.prompt_tokens, outputTokens: reported.completion_tokens }
          : {
              promptTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
              outputTokens: Math.ceil(completion.text.length / 4),
              estimated: true,
            },
      );
    }
    if (completion.finishReason === 'length') {
      // No text at all means the allowance went on reasoning before the lesson
      // started: lower ZRO_REASONING_EFFORT or raise ZRO_MAX_TOKENS.
      throw new ProviderError(
        'failed',
        completion.text.trim()
          ? 'The AI response was cut off before the lesson was complete. Try a shorter PDF.'
          : 'The AI used its whole output allowance before it started writing the lesson. Please try again.',
      );
    }
    if (!completion.text.trim()) {
      throw new ProviderError('failed', `The AI provider returned no content (${completion.finishReason || 'empty response'}).`);
    }
    return completion.text;
  }

  /** Accepts the streamed form, and a plain JSON body in case the provider ignores `stream`. */
  async #readCompletion(response: Response): Promise<Completion> {
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('application/json') || !response.body) {
      const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
      const choice = data?.choices?.[0];
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        finishReason: choice?.finish_reason,
        usage: data?.usage,
      };
    }
    return readStream(response.body);
  }
}
