import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  LIMITS,
  type ApiErrorBody,
  type ApiErrorCode,
  type GenerateResponse,
  type HealthResponse,
} from '../lib/learning/contracts.ts';
import type { Course } from '../lib/learning/types.ts';
import { documentIdFor } from '../lib/pdf/extract.ts';
import { generateCourse, GenerationError } from './generate.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { ProviderError, type AiProvider } from './providers/types.ts';
import { isAllowedOrigin, RateLimiter, TtlCache } from './security.ts';

/**
 * HTTP layer of the lesson backend.
 *
 * Privacy and safety choices:
 * - Document text is processed in memory only. It is never written to disk and never logged.
 * - Generated lessons are cached in memory (bounded, with expiry) keyed by a hash of the text.
 * - Browser access is limited to an origin allow-list, requests are size-capped and rate-limited.
 * - There is NO user authentication yet. That must be added before any public deployment.
 */

export interface AppOptions {
  provider: AiProvider;
  allowedOrigins: string[];
  /** Accept requests with no Origin header (curl, tests). Browsers always send one cross-site. */
  allowNoOrigin?: boolean;
  rateLimit?: { max: number; windowMs: number };
  /** Hard cap on AI calls per day across all clients, to stay inside a free quota. */
  dailyGenerationCap?: number;
  cache?: { maxEntries: number; ttlMs: number };
  log?: (line: string) => void;
}

const requestSchema = z.object({
  document: z.object({
    name: z.string().trim().min(1).max(200),
    pageCount: z.number().int().min(1).max(100_000),
    pages: z
      .array(z.object({ page: z.number().int().min(1).max(100_000), text: z.string().min(1).max(LIMITS.maxChars) }))
      .min(1)
      .max(LIMITS.maxPages),
  }),
});

class HttpError extends Error {
  status: number;
  code: ApiErrorCode;
  headers: Record<string, string>;

  constructor(status: number, code: ApiErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        req.resume();
        reject(new HttpError(413, 'too_large', 'The document is too large to process.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => !done && resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => !done && reject(new HttpError(400, 'invalid_request', 'The request could not be read.')));
  });
}

export function createApp(options: AppOptions): RequestListener {
  const { provider, allowedOrigins } = options;
  const limiter = new RateLimiter(options.rateLimit?.max ?? 6, options.rateLimit?.windowMs ?? 10 * 60_000);
  const cache = new TtlCache<Course>(options.cache?.maxEntries ?? 50, options.cache?.ttlMs ?? 24 * 60 * 60_000);
  const inFlight = new Map<string, Promise<Course>>();
  const dailyCap = options.dailyGenerationCap ?? 200;
  let day = '';
  let generationsToday = 0;
  const log = options.log ?? (() => undefined);

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    res.end(JSON.stringify(body));
  };

  async function handleGenerate(req: IncomingMessage): Promise<GenerateResponse> {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'invalid_request', 'Send the document as JSON.');
    }
    const client = req.socket.remoteAddress ?? 'unknown';
    const limit = limiter.check(client);
    if (!limit.ok) {
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${limit.retryAfterSec} seconds.`, {
        'retry-after': String(limit.retryAfterSec),
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(await readBody(req, LIMITS.maxBodyBytes));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'invalid_request', 'The request body is not valid JSON.');
    }
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The document data is missing or malformed.');
    const document = parsed.data.document;
    const pageNumbers = new Set(document.pages.map((p) => p.page));
    if (pageNumbers.size !== document.pages.length) {
      throw new HttpError(400, 'invalid_request', 'The document has duplicate page numbers.');
    }
    const chars = document.pages.reduce((n, p) => n + p.text.length, 0);
    if (chars > LIMITS.maxChars) throw new HttpError(413, 'too_large', 'The document is too large to process.');
    if (chars < LIMITS.minChars) {
      throw new HttpError(400, 'invalid_request', 'The document has too little text to build a lesson from.');
    }

    // The cache key comes from the text itself, so a client cannot poison another document's entry.
    const key = `${await documentIdFor(document.pages)}|${provider.id}|${provider.model}|${PROMPT_VERSION}`;
    const cached = cache.get(key);
    if (cached) return { course: cached, cached: true };

    let pending = inFlight.get(key);
    if (!pending) {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        generationsToday = 0;
      }
      if (generationsToday >= dailyCap) {
        throw new HttpError(503, 'provider_rate_limited', 'The daily lesson limit has been reached. Try again tomorrow.');
      }
      generationsToday++;
      pending = generateCourse(document, provider).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const course = await pending;
    cache.set(key, course);
    return { course, cached: false };
  }

  return async (req, res) => {
    const started = Date.now();
    const origin = req.headers.origin;
    const path = (req.url ?? '/').split('?')[0];
    const cors: Record<string, string> = {};
    let status = 500;
    try {
      const originOk = origin ? isAllowedOrigin(origin, allowedOrigins) : (options.allowNoOrigin ?? false);
      if (origin && originOk) {
        cors['access-control-allow-origin'] = origin;
        cors.vary = 'Origin';
      }
      if (!originOk) throw new HttpError(403, 'forbidden_origin', 'This site is not allowed to use the lesson service.');

      if (req.method === 'OPTIONS') {
        status = 204;
        res.writeHead(204, {
          ...cors,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        });
        res.end();
        return;
      }
      if (req.method === 'GET' && path === '/api/health') {
        status = 200;
        const body: HealthResponse = { ok: true, provider: provider.id, model: provider.model };
        send(res, 200, body, cors);
        return;
      }
      if (req.method === 'POST' && path === '/api/lessons/generate') {
        const body = await handleGenerate(req);
        status = 200;
        send(res, 200, body, cors);
        return;
      }
      throw new HttpError(404, 'not_found', 'Not found.');
    } catch (err) {
      let error: HttpError;
      if (err instanceof HttpError) error = err;
      else if (err instanceof ProviderError) {
        error =
          err.code === 'rate_limited'
            ? new HttpError(503, 'provider_rate_limited', err.message)
            : err.code === 'not_configured'
              ? new HttpError(503, 'provider_not_configured', 'The AI provider is not set up on the server.')
              : new HttpError(502, 'provider_error', err.message);
      } else if (err instanceof GenerationError) {
        error = new HttpError(err.code === 'nothing_grounded' ? 422 : 502, err.code, err.message);
      } else {
        // Unknown failures get a generic message; details stay out of responses.
        error = new HttpError(500, 'provider_error', 'Something went wrong while creating the lesson.');
      }
      status = error.status;
      const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
      if (!res.headersSent) send(res, error.status, body, { ...cors, ...error.headers });
      else res.end();
    } finally {
      // Method, path, status and timing only. Never document text or names.
      log(`${req.method} ${path} ${status} ${Date.now() - started}ms`);
    }
  };
}
