import type { ExtractedPage } from '../../lib/learning/contracts.ts';

/**
 * AI provider abstraction. The lesson pipeline only depends on this interface,
 * so providers (ZRO, Gemini, the offline mock) can be swapped without touching generation,
 * verification or the HTTP layer.
 */

export interface LessonRequest {
  /** Fixed instructions for the model. */
  system: string;
  /** The task plus the page-tagged document text. */
  prompt: string;
  /** The same pages as structured data, for providers that do not parse prompts (the offline mock). */
  pages: ExtractedPage[];
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  /** Returns the model's raw text, expected to be a JSON document. */
  generate(request: LessonRequest): Promise<string>;
}

export type ProviderErrorCode = 'not_configured' | 'rate_limited' | 'failed';

export class ProviderError extends Error {
  code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProviderError';
  }
}
