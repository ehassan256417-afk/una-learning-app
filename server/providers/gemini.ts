import { ProviderError, type AiProvider, type LessonRequest } from './types.ts';

/**
 * Google Gemini via the Generative Language REST API (free tier compatible).
 *
 * The API key is read from the server environment and sent in a request
 * header. It never appears in a URL, a log line or any response body, and this
 * module is never imported by browser code.
 */

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: GeminiOptions) {
    if (!options.apiKey) throw new ProviderError('not_configured', 'GEMINI_API_KEY is not set on the server.');
    this.apiKey = options.apiKey;
    this.model = options.model || DEFAULT_GEMINI_MODEL;
    this.baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: LessonRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192 },
        }),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new ProviderError('failed', timedOut ? 'The AI provider took too long to respond.' : 'Could not reach the AI provider.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      throw new ProviderError('rate_limited', 'The free AI quota is used up for now. Try again in a few minutes.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('not_configured', 'The AI provider rejected the server credentials.');
    }
    if (!response.ok) {
      // The provider's error body is not forwarded: it can echo request details.
      throw new ProviderError('failed', `The AI provider returned an error (HTTP ${response.status}).`);
    }

    const data = (await response.json().catch(() => null)) as GeminiResponse | null;
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) {
      const why = data?.promptFeedback?.blockReason || candidate?.finishReason || 'empty response';
      throw new ProviderError('failed', `The AI provider returned no content (${why}).`);
    }
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new ProviderError('failed', 'The AI response was cut off. Try a shorter PDF.');
    }
    return text;
  }
}
