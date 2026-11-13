import type { BudgetUse, Course, GroundingReport, LessonPlan, PlanConcept, PlannedLesson, Section } from './types.ts';

/**
 * Shapes shared by the static frontend and the lesson backend.
 * Only extracted text crosses this boundary; the PDF file never does.
 */

export const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxPages: 60,
  /** Total extracted characters kept from one document. */
  maxChars: 150_000,
  /** Below this, the PDF is treated as having no usable text (e.g. a scan). */
  minChars: 400,
  /** Upper bound for a request body accepted by the backend. */
  maxBodyBytes: 500_000,
} as const;

export interface ExtractedPage {
  /** 1-based page number in the PDF. */
  page: number;
  text: string;
}

export interface ExtractedDocument {
  /** SHA-256 of the extracted text. */
  id: string;
  name: string;
  pageCount: number;
  pages: ExtractedPage[];
  charCount: number;
  truncated?: boolean;
}

export interface GenerateRequest {
  document: { name: string; pageCount: number; pages: ExtractedPage[] };
}

export interface GenerateResponse {
  course: Course;
  /** True when the backend reused an earlier result instead of calling the AI provider. */
  cached: boolean;
}

/** Stage 1 of adaptive generation: one AI request that returns a verified lesson plan. */
export interface PlanRequest {
  document: { name: string; pageCount: number; pages: ExtractedPage[] };
}

export interface PlanResponse {
  /** SHA-256 of the extracted text, computed by the backend. */
  documentId: string;
  plan: LessonPlan;
  provider: string;
  model: string;
  cached: boolean;
  budget: BudgetUse;
}

/** Stage 2: one AI request per planned lesson, sent only the pages that lesson needs. */
export interface LessonGenerateRequest {
  documentId: string;
  documentName: string;
  lesson: PlannedLesson;
  /** The planned concepts this lesson teaches, with their evidence quotes. */
  concepts: PlanConcept[];
  pages: ExtractedPage[];
  /** Names of concepts taught in earlier lessons, so they are not explained again. */
  taught?: string[];
}

export interface LessonGenerateResponse {
  section: Section;
  report: GroundingReport;
  cached: boolean;
  budget: BudgetUse;
}

export type ApiErrorCode =
  | 'budget_exhausted'
  | 'invalid_request'
  | 'too_large'
  | 'forbidden_origin'
  | 'rate_limited'
  | 'provider_not_configured'
  | 'provider_rate_limited'
  | 'provider_error'
  | 'invalid_ai_output'
  | 'nothing_grounded'
  | 'not_found';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export interface HealthResponse {
  ok: true;
  provider: string;
  model: string;
}
