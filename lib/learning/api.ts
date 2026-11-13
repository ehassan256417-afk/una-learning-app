import type {
  ApiErrorBody,
  ApiErrorCode,
  ExtractedDocument,
  GenerateRequest,
  GenerateResponse,
  HealthResponse,
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
