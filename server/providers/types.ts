import type { ExtractedPage } from '../../lib/learning/contracts.ts';
import type { PlanConcept, PlannedLesson } from '../../lib/learning/types.ts';

/**
 * AI provider abstraction. The lesson pipeline only depends on this interface,
 * so providers (ZRO, Gemini, the offline mock) can be swapped without touching generation,
 * verification or the HTTP layer.
 */

/** Tokens one request used. `estimated` when the provider did not report them. */
export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  estimated?: boolean;
}

export interface LessonRequest {
  /** Fixed instructions for the model. */
  system: string;
  /** The task plus the page-tagged document text. */
  prompt: string;
  /** The same pages as structured data, for providers that do not parse prompts (the offline mock). */
  pages: ExtractedPage[];
  /**
   * What is being asked for. Absent means the original single-request course.
   * The structured fields are for the offline mock, which does not read prompts.
   */
  task?:
    | { kind: 'plan'; maxLessons: number }
    | { kind: 'lesson'; lesson: PlannedLesson; concepts: PlanConcept[] };
  /** Output cap for this request. Providers use the smaller of this and their own limit. */
  maxTokens?: number;
  /** Called once with the tokens the request used, including when the answer is then rejected. */
  onUsage?: (usage: TokenUsage) => void;
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  /** Returns the model's raw text, expected to be a JSON document. */
  generate(request: LessonRequest): Promise<string>;
}

/**
 * `unavailable` is a 5xx answer: the provider could not take the request at
 * all, so no tokens were used and the document is not the cause. `failed`
 * covers everything else that went wrong, including answers that did cost tokens.
 */
export type ProviderErrorCode = 'not_configured' | 'rate_limited' | 'unavailable' | 'failed';

export class ProviderError extends Error {
  code: ProviderErrorCode;
  /** Seconds to wait before asking again, when known. */
  retryAfterSec?: number;

  constructor(code: ProviderErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.code = code;
    this.name = 'ProviderError';
    if (retryAfterSec !== undefined) this.retryAfterSec = retryAfterSec;
  }
}

/** Reads a Retry-After header given in whole seconds. Dates and anything else are ignored. */
export function retryAfterSeconds(value: string | null): number | undefined {
  const text = (value ?? '').trim();
  return /^\d{1,6}$/.test(text) ? Number(text) : undefined;
}

/**
 * The error for a 5xx status. The provider's error body is never read into it:
 * it can echo request details.
 */
export function unavailableError(response: Response): ProviderError {
  return new ProviderError(
    'unavailable',
    `The AI provider is temporarily unavailable (HTTP ${response.status}).`,
    retryAfterSeconds(response.headers.get('retry-after')),
  );
}
