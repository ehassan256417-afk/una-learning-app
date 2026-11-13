import { createHash } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  LIMITS,
  type ApiErrorBody,
  type ApiErrorCode,
  type GenerateResponse,
  type HealthResponse,
  type LessonGenerateResponse,
  type PlanResponse,
} from '../lib/learning/contracts.ts';
import type { Course, LessonPlan } from '../lib/learning/types.ts';
import { documentIdFor } from '../lib/pdf/extract.ts';
import { BudgetError, CourseBudgets, estimateTokens, type BudgetLimits } from './budget.ts';
import { generateCourse, GenerationError } from './generate.ts';
import { checkLessonInput, createLesson, LESSON_CHAR_BUDGET, LESSON_VERSION, type LessonInput } from './lesson.ts';
import { createPlan, PLAN_CHAR_BUDGET, PLAN_VERSION } from './plan.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { ProviderError, type AiProvider, type TokenUsage } from './providers/types.ts';
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
  /** Adaptive generation: AI requests and tokens allowed for one course (plan plus lessons). */
  courseBudget?: BudgetLimits;
  /** Output caps for one planning request and one lesson request. */
  planMaxTokens?: number;
  lessonMaxTokens?: number;
  log?: (line: string) => void;
}

/** Characters of fixed instructions sent with every request, for the worst-case token estimate. */
const PROMPT_OVERHEAD_CHARS = 5_000;

type LessonResult = Awaited<ReturnType<typeof createLesson>>;

const pageNumber = z.number().int().min(1).max(100_000);
const levelSchema = z.enum(['Beginner', 'Intermediate', 'Advanced']);
const shortId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

const lessonRequestSchema = z.object({
  documentId: z.string().regex(/^[0-9a-f]{64}$/),
  documentName: z.string().trim().min(1).max(200),
  lesson: z.object({
    id: shortId,
    title: z.string().trim().min(1).max(160),
    difficulty: levelSchema,
    conceptIds: z.array(shortId).min(1).max(8),
    objectives: z.array(z.string().trim().min(1).max(200)).max(4),
    pages: z.array(pageNumber).min(1).max(LIMITS.maxPages),
  }),
  concepts: z
    .array(
      z.object({
        id: shortId,
        name: z.string().trim().min(1).max(120),
        summary: z.string().trim().min(1).max(400),
        difficulty: levelSchema,
        importance: z.enum(['core', 'supporting']),
        pages: z.array(pageNumber).max(80),
        prerequisites: z.array(shortId).max(12),
        evidence: z
          .array(
            z.object({
              documentId: z.string().max(80),
              page: pageNumber,
              excerpt: z.string().min(1).max(800),
              support: z.enum(['exact', 'close']).optional(),
            }),
          )
          .min(1)
          .max(6),
      }),
    )
    .min(1)
    .max(8),
  pages: z
    .array(z.object({ page: pageNumber, text: z.string().min(1).max(LIMITS.maxChars) }))
    .min(1)
    .max(LIMITS.maxPages),
  taught: z.array(z.string().max(120)).max(60).optional(),
});

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

  // Adaptive generation: one plan request plus one request per lesson, inside a per-course budget.
  const courseBudget = options.courseBudget ?? { maxRequests: 12, maxTokens: 120_000 };
  const budgets = new CourseBudgets(courseBudget);
  // One request is the plan, and one is kept spare so a failed lesson can be requested again.
  const maxLessons = Math.max(1, courseBudget.maxRequests - 2);
  const planMaxTokens = options.planMaxTokens ?? 8_000;
  const lessonMaxTokens = options.lessonMaxTokens ?? 6_000;
  const cacheTtl = options.cache?.ttlMs ?? 24 * 60 * 60_000;
  const planCache = new TtlCache<LessonPlan>(options.cache?.maxEntries ?? 50, cacheTtl);
  const lessonCache = new TtlCache<LessonResult>(300, cacheTtl);
  /** Courses (client plus document) this server has planned, which gives their lessons a budget of their own. */
  const plannedCourses = new TtlCache<true>(5000, cacheTtl);
  const plansInFlight = new Map<string, Promise<LessonPlan>>();
  const lessonsInFlight = new Map<string, Promise<LessonResult>>();
  // Lesson requests are bounded by the course budget; this only stops a client hammering the endpoint.
  const lessonLimiter = new RateLimiter(
    (options.rateLimit?.max ?? 6) * courseBudget.maxRequests,
    options.rateLimit?.windowMs ?? 10 * 60_000,
  );
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

  /** Shared entry checks: JSON content type, per-client rate limit, size-capped body. */
  async function readJson(req: IncomingMessage, gate: RateLimiter): Promise<{ json: unknown; client: string }> {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'invalid_request', 'Send the document as JSON.');
    }
    const client = req.socket.remoteAddress ?? 'unknown';
    const limit = gate.check(client);
    if (!limit.ok) {
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${limit.retryAfterSec} seconds.`, {
        'retry-after': String(limit.retryAfterSec),
      });
    }
    try {
      return { json: JSON.parse(await readBody(req, LIMITS.maxBodyBytes)), client };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'invalid_request', 'The request body is not valid JSON.');
    }
  }

  function checkPages(pages: Array<{ page: number; text: string }>, minChars: number): number {
    if (new Set(pages.map((p) => p.page)).size !== pages.length) {
      throw new HttpError(400, 'invalid_request', 'The document has duplicate page numbers.');
    }
    const chars = pages.reduce((n, p) => n + p.text.length, 0);
    if (chars > LIMITS.maxChars) throw new HttpError(413, 'too_large', 'The document is too large to process.');
    if (chars < minChars) {
      throw new HttpError(400, 'invalid_request', 'The document has too little text to build a lesson from.');
    }
    return chars;
  }

  function parseDocument(json: unknown) {
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The document data is missing or malformed.');
    const document = parsed.data.document;
    return { document, chars: checkPages(document.pages, LIMITS.minChars) };
  }

  /** Counts one AI call against the daily cap, or refuses it. */
  function countAiCall() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      generationsToday = 0;
    }
    if (generationsToday >= dailyCap) {
      throw new HttpError(503, 'provider_rate_limited', 'The daily lesson limit has been reached. Try again tomorrow.');
    }
    generationsToday++;
  }

  /**
   * Runs one AI request inside the course budget. The request is refused,
   * without calling the provider, if its worst case does not fit.
   */
  async function spend<T>(
    budgetKey: string,
    worstCaseTokens: number,
    run: (onUsage: (u: TokenUsage) => void) => Promise<T>,
  ): Promise<T> {
    // The daily cap is checked first so a refusal there does not use up the course budget.
    countAiCall();
    let settle: (tokens: number) => void;
    try {
      settle = budgets.begin(budgetKey, worstCaseTokens);
    } catch (err) {
      generationsToday--;
      if (err instanceof BudgetError) throw new HttpError(429, 'budget_exhausted', err.message);
      throw err;
    }
    let used = 0;
    try {
      return await run((u) => {
        used = u.promptTokens + u.outputTokens;
      });
    } finally {
      settle(used);
    }
  }

  async function handleGenerate(req: IncomingMessage): Promise<GenerateResponse> {
    const { json } = await readJson(req, limiter);
    const { document } = parseDocument(json);

    // The cache key comes from the text itself, so a client cannot poison another document's entry.
    const key = `${await documentIdFor(document.pages)}|${provider.id}|${provider.model}|${PROMPT_VERSION}`;
    const cached = cache.get(key);
    if (cached) return { course: cached, cached: true };

    let pending = inFlight.get(key);
    if (!pending) {
      countAiCall();
      pending = generateCourse(document, provider).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const course = await pending;
    cache.set(key, course);
    return { course, cached: false };
  }

  /** Adaptive stage 1: one AI request that returns a verified lesson plan. */
  async function handlePlan(req: IncomingMessage): Promise<PlanResponse> {
    const { json, client } = await readJson(req, limiter);
    const { document, chars } = parseDocument(json);
    const documentId = await documentIdFor(document.pages);
    const budgetKey = `${client}|${documentId}`;
    const key = `${documentId}|${provider.id}|${provider.model}|${PLAN_VERSION}|${maxLessons}`;
    const respond = (plan: LessonPlan, cached: boolean): PlanResponse => ({
      documentId,
      plan,
      provider: provider.id,
      model: provider.model,
      cached,
      budget: budgets.use(budgetKey),
    });

    // Lesson requests for this document may now draw on this course's budget.
    plannedCourses.set(budgetKey, true);
    const cached = planCache.get(key);
    if (cached) return respond(cached, true);
    // Requests are shared only within one client's course, so nobody inherits another client's budget refusal.
    const flight = `${budgetKey}|${key}`;
    let pending = plansInFlight.get(flight);
    if (!pending) {
      const worstCase = estimateTokens(Math.min(chars, PLAN_CHAR_BUDGET) + PROMPT_OVERHEAD_CHARS) + planMaxTokens;
      pending = spend(budgetKey, worstCase, (onUsage) =>
        createPlan(document, provider, { maxLessons, maxTokens: planMaxTokens, onUsage }),
      )
        .then((r) => r.plan)
        .finally(() => plansInFlight.delete(flight));
      plansInFlight.set(flight, pending);
    }
    const plan = await pending;
    planCache.set(key, plan);
    return respond(plan, false);
  }

  /** Adaptive stage 2: one AI request that writes one planned lesson from its own pages. */
  async function handleLesson(req: IncomingMessage): Promise<LessonGenerateResponse> {
    const { json, client } = await readJson(req, lessonLimiter);
    const parsed = lessonRequestSchema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The lesson request is missing or malformed.');
    const body = parsed.data;
    const chars = checkPages(body.pages, 1);
    const input: LessonInput = { ...body, taught: body.taught ?? [] };
    // The plan data comes from the browser, so it is checked against the page text again.
    if (checkLessonInput(input)) {
      throw new HttpError(400, 'invalid_request', 'The lesson plan does not match the document text.');
    }

    // The document id comes from the browser here. Only an id this server planned for this client gets
    // its own budget; any other id shares one budget, so inventing ids does not unlock more requests.
    const courseKey = `${client}|${body.documentId}`;
    const budgetKey = plannedCourses.get(courseKey) ? courseKey : `${client}|unplanned`;
    // Everything that reaches the prompt or the stored lesson is part of the cache key.
    const digest = createHash('sha256')
      .update(JSON.stringify([body.documentId, body.documentName, body.pages, body.lesson, body.concepts, input.taught, lessonMaxTokens]))
      .digest('hex');
    const key = `${digest}|${provider.id}|${provider.model}|${LESSON_VERSION}`;
    const respond = (result: LessonResult, cached: boolean): LessonGenerateResponse => ({
      ...result,
      cached,
      budget: budgets.use(budgetKey),
    });

    const cached = lessonCache.get(key);
    if (cached) return respond(cached, true);
    const flight = `${budgetKey}|${key}`;
    let pending = lessonsInFlight.get(flight);
    if (!pending) {
      const worstCase = estimateTokens(Math.min(chars, LESSON_CHAR_BUDGET) + PROMPT_OVERHEAD_CHARS) + lessonMaxTokens;
      pending = spend(budgetKey, worstCase, (onUsage) =>
        createLesson(input, provider, { maxTokens: lessonMaxTokens, onUsage }),
      ).finally(() => lessonsInFlight.delete(flight));
      lessonsInFlight.set(flight, pending);
    }
    const result = await pending;
    lessonCache.set(key, result);
    return respond(result, false);
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
      if (req.method === 'POST' && path === '/api/lessons/plan') {
        const body = await handlePlan(req);
        status = 200;
        send(res, 200, body, cors);
        return;
      }
      if (req.method === 'POST' && path === '/api/lessons/lesson') {
        const body = await handleLesson(req);
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
