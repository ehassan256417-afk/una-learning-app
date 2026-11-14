import type { ApiErrorBody } from '../learning/contracts.ts';
import type { AccountUser } from './contracts.ts';

/**
 * Browser client for the platform backend.
 *
 * The session token is kept in localStorage and sent in the Authorization
 * header. A cookie would not work here: the site (GitHub Pages) and the
 * backend live on different domains, and browsers block cross-site cookies.
 * The site loads no third-party scripts, which is what keeps this safe.
 */

export const API_URL = (
  process.env.NEXT_PUBLIC_LESSON_API_URL ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:8787' : '')
).replace(/\/$/, '');

const SESSION_KEY = 'una-learning:session:v1';

export interface StoredSession {
  token: string;
  user: AccountUser;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'ApiError';
  }
}

let current: StoredSession | null | undefined;
const listeners = new Set<() => void>();

export function readSession(): StoredSession | null {
  if (current !== undefined) return current;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? 'null') as StoredSession | null;
    current = parsed && typeof parsed.token === 'string' && typeof parsed.user?.id === 'string' ? parsed : null;
  } catch {
    current = null;
  }
  return current;
}

export function writeSession(session: StoredSession | null) {
  current = session;
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session then lasts until the tab closes.
  }
  listeners.forEach((fn) => fn());
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The id that scopes saved data in this browser: the signed-in account, or '' for device-only use. */
export const currentUserId = (): string => (typeof window === 'undefined' ? '' : (readSession()?.user.id ?? ''));

export const authHeaders = (): Record<string, string> => {
  const token = typeof window === 'undefined' ? undefined : readSession()?.token;
  return token ? { authorization: `Bearer ${token}` } : {};
};

/** Called when the backend says the session is no longer valid. */
let onExpired: (() => void) | null = null;
export const setExpiredHandler = (fn: (() => void) | null) => {
  onExpired = fn;
};

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Lets the request finish while the page is closing. */
  keepalive?: boolean;
  /** Do not treat a 401 as "the session expired" (used by sign-in itself). */
  quiet401?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_URL) throw new ApiError('not_connected', 'Accounts are not connected on this site yet.');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders() },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      keepalive: options.keepalive,
    });
  } catch {
    throw new ApiError('network', 'Could not reach UNA Learning. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? (body as ApiErrorBody).error : null;
    if (res.status === 401 && !options.quiet401 && readSession()) onExpired?.();
    // A 409 on progress carries the newer copy; callers that need it read `payload`.
    const failure = new ApiError(error?.code ?? (res.status === 409 ? 'conflict' : 'bad_response'), error?.message ?? `The service returned an error (${res.status}).`, res.status);
    (failure as ApiError & { payload?: unknown }).payload = body;
    throw failure;
  }
  return body as T;
}

export const errorPayload = <T>(err: unknown): T | undefined => (err as { payload?: T } | null)?.payload;

/** Work that must reach the account before signing out (unsaved progress, courses still uploading). */
const flushers = new Set<() => Promise<void>>();
export function registerFlusher(fn: () => Promise<void>): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}
export const runFlushers = () => Promise.allSettled([...flushers].map((fn) => fn()));

/** Removes one account's cached data from this browser (used on sign-out, so a shared computer keeps nothing). */
export function clearAccountCache(userId: string) {
  if (!userId) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('una-learning:') && key.endsWith(`:${userId}`)) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}
