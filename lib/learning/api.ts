import type {
  ApiErrorBody,
  ApiErrorCode,
  ExtractedDocument,
  GenerateRequest,
  GenerateResponse,
  HealthResponse,
  LessonGenerateRequest,
  LessonGenerateResponse,
  PlanRequest,
  PlanResponse,
} from './contracts.ts';

/**
 * Browser client for the lesson backend.
 *
 * Only a base URL lives here. API keys stay on the backend and are never part
 * of the frontend bundle. With no URL configured (the GitHub Pages build),
 * lesson generation is reported as unavailable.
 */
export const LESSON_API_URL = (
  process.env.NEXT_PUBLIC_LESSON_API_URL ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:8787' : '')
).replace(/\/$/, '');

export type ClientErrorCode = ApiErrorCode | 'not_connected' | 'network' | 'bad_response';

export class LessonApiError extends Error {
  code: ClientErrorCode;

  constructor(code: ClientErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'LessonApiError';
  }
}

export async function checkBackend(signal?: AbortSignal): Promise<HealthResponse | null> {
  if (!LESSON_API_URL) return null;
  try {
    const res = await fetch(`${LESSON_API_URL}/api/health`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as HealthResponse;
    return body?.ok ? body : null;
  } catch {
    return null;
  }
}

async function post<T>(path: string, payload: unknown, isValid: (body: unknown) => boolean, signal?: AbortSignal): Promise<T> {
  if (!LESSON_API_URL) {
    throw new LessonApiError('not_connected', 'Lesson generation is not connected on this site yet.');
  }
  let res: Response;
  try {
    res = await fetch(`${LESSON_API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new LessonApiError('network', 'Could not reach the lesson service. Check that it is running and try again.');
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? (body as ApiErrorBody).error : null;
    throw new LessonApiError(error?.code ?? 'bad_response', error?.message ?? `The lesson service returned an error (${res.status}).`);
  }
  if (!isValid(body)) throw new LessonApiError('bad_response', 'The lesson service sent an unexpected response.');
  return body as T;
}

/** Adaptive stage 1: asks for a lesson plan (one AI request). */
export const requestPlan = (doc: ExtractedDocument, signal?: AbortSignal): Promise<PlanResponse> =>
  post<PlanResponse>(
    '/api/lessons/plan',
    { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } } satisfies PlanRequest,
    (b) => {
      const r = b as PlanResponse | null;
      return !!r && typeof r.documentId === 'string' && Array.isArray(r.plan?.lessons) && Array.isArray(r.plan?.concepts);
    },
    signal,
  );

/** Adaptive stage 2: asks for one planned lesson (one AI request). */
export const requestLesson = (body: LessonGenerateRequest, signal?: AbortSignal): Promise<LessonGenerateResponse> =>
  post<LessonGenerateResponse>(
    '/api/lessons/lesson',
    body,
    (b) => {
      const r = b as LessonGenerateResponse | null;
      return !!r && typeof r.section?.id === 'string' && Array.isArray(r.section.notes) && Array.isArray(r.section.questions);
    },
    signal,
  );

export async function requestLessons(doc: ExtractedDocument, signal?: AbortSignal): Promise<GenerateResponse> {
  if (!LESSON_API_URL) {
    throw new LessonApiError('not_connected', 'Lesson generation is not connected on this site yet.');
  }
  const payload: GenerateRequest = { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } };
  let res: Response;
  try {
    res = await fetch(`${LESSON_API_URL}/api/lessons/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new LessonApiError('network', 'Could not reach the lesson service. Check that it is running and try again.');
  }
  const body = (await res.json().catch(() => null)) as GenerateResponse | ApiErrorBody | null;
  if (!res.ok) {
    const error = body && 'error' in body ? body.error : null;
    throw new LessonApiError(error?.code ?? 'bad_response', error?.message ?? `The lesson service returned an error (${res.status}).`);
  }
  if (!body || !('course' in body) || !Array.isArray(body.course?.sections)) {
    throw new LessonApiError('bad_response', 'The lesson service sent an unexpected response.');
  }
  return body;
}
