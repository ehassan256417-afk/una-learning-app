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

export type ProviderErrorCode = 'not_configured' | 'rate_limited' | 'failed';

export class ProviderError extends Error {
  code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProviderError';
  }
}
