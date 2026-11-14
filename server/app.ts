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
import { bearerToken, clientAddress, HttpError, readBody } from './http.ts';
import type { UserRow } from './accounts.ts';
import type { AiLogStart, Platform } from './platform.ts';
import { createPlatformRoutes } from './routes.ts';
import { isAllowedOrigin, RateLimiter, TtlCache } from './security.ts';

/**
 * HTTP layer of the lesson backend.
 *
 * Privacy and safety choices:
 * - Document text is processed in memory only. It is never written to disk and never logged.
 * - Generated lessons are cached in memory (bounded, with expiry) keyed by a hash of the text.
 * - Browser access is limited to an origin allow-list, requests are size-capped and rate-limited.
 * - With a `platform` (accounts and a database), every AI request needs a signed-in student, is
 *   counted against that student's limits and is written to the AI request log. Without one
 *   (tests, the validation scripts) the lesson endpoints stay anonymous: never deploy that mode.
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
  /** Accounts, saved learning data, activity and the owner API. See the note above. */
  platform?: Platform;
  /** Builds a provider for a model name chosen in the owner's settings. */
  providerFor?: (model: string) => AiProvider;
  /** Set when the server sits behind a reverse proxy that adds X-Forwarded-For. */
  trustProxy?: boolean;
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
        includes: z
          .array(z.object({ name: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(400) }))
          .max(3)
          .optional(),
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

export function createApp(options: AppOptions): RequestListener {
  const { allowedOrigins, platform } = options;
  const trustProxy = options.trustProxy ?? false;
  const limiter = new RateLimiter(options.rateLimit?.max ?? 6, options.rateLimit?.windowMs ?? 10 * 60_000);
  const cache = new TtlCache<Course>(options.cache?.maxEntries ?? 50, options.cache?.ttlMs ?? 24 * 60 * 60_000);
  const inFlight = new Map<string, Promise<Course>>();
  const dailyCap = options.dailyGenerationCap ?? 200;

  // Adaptive generation: one plan request plus one request per lesson, inside a per-course budget.
  const baseBudget = options.courseBudget ?? { maxRequests: 12, maxTokens: 120_000 };
  const budgets = new CourseBudgets(baseBudget);
  /** The course budget in force: the owner's settings when there is a platform, else the server's options. */
  const courseBudget = (): BudgetLimits => {
    if (!platform) return baseBudget;
    const { courseMaxRequests, courseMaxTokens } = platform.settings().limits;
    const limits = { maxRequests: courseMaxRequests, maxTokens: courseMaxTokens };
    budgets.setLimits(limits);
    return limits;
  };
  // One request is the plan, and one is kept spare so a failed lesson can be requested again.
  const maxLessons = () => Math.max(1, courseBudget().maxRequests - 2);
  const planMaxTokens = options.planMaxTokens ?? 8_000;
  const lessonMaxTokens = options.lessonMaxTokens ?? 6_000;
  const cacheTtl = options.cache?.ttlMs ?? 24 * 60 * 60_000;
  const planCache = new TtlCache<LessonPlan>(options.cache?.maxEntries ?? 50, cacheTtl);
  const lessonCache = new TtlCache<LessonResult>(300, cacheTtl);
  /** Courses (caller plus document) this server has planned, which gives their lessons a budget of their own. */
  const plannedCourses = new TtlCache<true>(5000, cacheTtl);
  const plansInFlight = new Map<string, Promise<LessonPlan>>();
  const lessonsInFlight = new Map<string, Promise<LessonResult>>();
  // Lesson requests are bounded by the course budget; this only stops a client hammering the endpoint.
  const lessonLimiter = new RateLimiter(
    (options.rateLimit?.max ?? 6) * (platform ? 60 : baseBudget.maxRequests),
    options.rateLimit?.windowMs ?? 10 * 60_000,
  );
  let day = '';
  let generationsToday = 0;
  const log = options.log ?? (() => undefined);
  const httpStats = { total: 0, clientErrors: 0, serverErrors: 0 };

  /** The provider in use: the server's own, or one built for the model the owner picked in settings. */
  const modelProviders = new Map<string, AiProvider>();
  const activeProvider = (): AiProvider => {
    const model = platform?.settings().ai.model;
    if (!model || !options.providerFor || model === options.provider.model) return options.provider;
    let chosen = modelProviders.get(model);
    if (!chosen) {
      chosen = options.providerFor(model);
      modelProviders.set(model, chosen);
    }
    return chosen;
  };

  const platformRoutes = platform
    ? createPlatformRoutes(platform, {
        provider: () => {
          const p = activeProvider();
          return { id: p.id, model: p.model };
        },
        httpStats,
      })
    : null;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    res.end(JSON.stringify(body));
  };

  /** Who is asking for AI work. Limits and budgets are tied to `key`. */
  interface Caller {
    key: string;
    user?: UserRow;
  }

  /**
   * With a platform, AI work needs a signed-in student and is tied to their
   * account, so students behind one campus address do not share a limit.
   * Without one, the caller is the network address (tests and local scripts).
   */
  function callerOf(req: IncomingMessage, user: UserRow | undefined): Caller {
    if (!platform) return { key: clientAddress(req, trustProxy) };
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to create lessons.');
    if (!platform.settings().features.generation) {
      throw new HttpError(503, 'feature_disabled', 'Creating lessons is switched off at the moment. Your saved lessons still work.');
    }
    return { key: user.id, user };
  }

  /** Shared entry checks: JSON content type, per-caller rate limit, size-capped body. */
  async function readJson(req: IncomingMessage, gate: RateLimiter, who: Caller): Promise<unknown> {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'invalid_request', 'Send the document as JSON.');
    }
    const limit = gate.check(who.key);
    if (!limit.ok) {
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${limit.retryAfterSec} seconds.`, {
        'retry-after': String(limit.retryAfterSec),
      });
    }
    try {
      return JSON.parse(await readBody(req, LIMITS.maxBodyBytes)) as unknown;
    } catch (err) {
      if (err instanceof HttpError) throw new HttpError(err.status, err.code, 'The document is too large to process.');
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

  /**
   * Counts one AI call against the daily limits, or refuses it. With a platform
   * the count is the AI request log itself, so it survives a restart and is the
   * same number the owner sees; a request that is refused is not counted.
   */
  function countAiCall(who: Caller) {
    if (platform) {
      const { dailyAiRequests, userDailyAiRequests } = platform.settings().limits;
      if (platform.aiCountToday() >= dailyAiRequests) {
        throw new HttpError(503, 'provider_rate_limited', 'The daily lesson limit has been reached. Try again tomorrow.');
      }
      if (who.user && platform.aiCountToday(who.user.id) >= userDailyAiRequests) {
        throw new HttpError(429, 'limit_reached', `You have used all ${userDailyAiRequests} AI requests for today. The count resets at midnight UTC.`);
      }
      return;
    }
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

  const failureOf = (err: unknown): { code: string; message: string } => {
    if (err instanceof HttpError || err instanceof GenerationError) return { code: err.code, message: err.message };
    if (err instanceof ProviderError) return { code: `provider_${err.code}`, message: err.message };
    return { code: 'unexpected', message: 'Unexpected error.' };
  };

  /** Runs one provider request and, with a platform, writes its outcome, timing and tokens to the AI log. */
  async function tracked<T>(
    start: AiLogStart,
    run: (onUsage: (u: TokenUsage) => void) => Promise<T>,
    after?: (tokens: number) => void,
  ): Promise<T> {
    // Written as "running" before the provider is called, so it counts against the daily limits at once.
    const logId = platform?.beginAi(start);
    const began = Date.now();
    const seen: { usage?: TokenUsage } = {};
    const finish = (status: 'ok' | 'failed', failure?: { code: string; message: string }) => {
      if (logId === undefined) return;
      platform?.finishAi(logId, {
        status,
        promptTokens: seen.usage?.promptTokens,
        outputTokens: seen.usage?.outputTokens,
        tokensEstimated: seen.usage ? !!seen.usage.estimated : false,
        durationMs: Date.now() - began,
        errorCode: failure?.code,
        errorMessage: failure?.message,
      });
    };
    try {
      const result = await run((u) => {
        seen.usage = u;
      });
      finish('ok');
      return result;
    } catch (err) {
      finish('failed', failureOf(err));
      throw err;
    } finally {
      after?.(seen.usage ? seen.usage.promptTokens + seen.usage.outputTokens : 0);
    }
  }

  /**
   * Runs one AI request inside the course budget. The request is refused,
   * without calling the provider, if its worst case does not fit.
   */
  async function spend<T>(
    who: Caller,
    start: AiLogStart,
    budgetKey: string,
    worstCaseTokens: number,
    run: (onUsage: (u: TokenUsage) => void) => Promise<T>,
  ): Promise<T> {
    let settle: (tokens: number) => void;
    try {
      // The daily cap is checked first so a refusal there does not use up the course budget.
      countAiCall(who);
      try {
        settle = budgets.begin(budgetKey, worstCaseTokens);
      } catch (err) {
        if (!platform) generationsToday--;
        if (err instanceof BudgetError) throw new HttpError(429, 'budget_exhausted', err.message);
        throw err;
      }
    } catch (err) {
      // Refusals are logged for the owner, but never counted as spend.
      if (err instanceof HttpError) platform?.logAiOutcome(start, { refused: err.code, message: err.message });
      throw err;
    }
    return tracked(start, run, (tokens) => settle(tokens));
  }

  async function handleGenerate(req: IncomingMessage, user: UserRow | undefined): Promise<GenerateResponse> {
    const who = callerOf(req, user);
    const provider = activeProvider();
    const { document } = parseDocument(await readJson(req, limiter, who));

    // The cache key comes from the text itself, so a client cannot poison another document's entry.
    const documentId = await documentIdFor(document.pages);
    const key = `${documentId}|${provider.id}|${provider.model}|${PROMPT_VERSION}`;
    const start: AiLogStart = { userId: user?.id ?? null, kind: 'course', provider: provider.id, model: provider.model, documentId };
    const cached = cache.get(key);
    if (cached) {
      platform?.logAiOutcome(start, { cached: true });
      return { course: cached, cached: true };
    }

    let pending = inFlight.get(key);
    if (!pending) {
      countAiCall(who);
      pending = tracked(start, () => generateCourse(document, provider)).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const course = await pending;
    cache.set(key, course);
    return { course, cached: false };
  }

  /** Adaptive stage 1: one AI request that returns a verified lesson plan. */
  async function handlePlan(req: IncomingMessage, user: UserRow | undefined): Promise<PlanResponse> {
    const who = callerOf(req, user);
    const provider = activeProvider();
    const { document, chars } = parseDocument(await readJson(req, limiter, who));
    const documentId = await documentIdFor(document.pages);
    const budgetKey = `${who.key}|${documentId}`;
    const lessons = maxLessons();
    const key = `${documentId}|${provider.id}|${provider.model}|${PLAN_VERSION}|${lessons}`;
    const start: AiLogStart = { userId: user?.id ?? null, kind: 'plan', provider: provider.id, model: provider.model, documentId };
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
    if (cached) {
      platform?.logAiOutcome(start, { cached: true });
      return respond(cached, true);
    }
    // Requests are shared only within one caller's course, so nobody inherits another caller's budget refusal.
    const flight = `${budgetKey}|${key}`;
    let pending = plansInFlight.get(flight);
    if (!pending) {
      const worstCase = estimateTokens(Math.min(chars, PLAN_CHAR_BUDGET) + PROMPT_OVERHEAD_CHARS) + planMaxTokens;
      pending = spend(who, start, budgetKey, worstCase, (onUsage) =>
        createPlan(document, provider, { maxLessons: lessons, maxTokens: planMaxTokens, onUsage }),
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
  async function handleLesson(req: IncomingMessage, user: UserRow | undefined): Promise<LessonGenerateResponse> {
    const who = callerOf(req, user);
    const provider = activeProvider();
    courseBudget();
    const parsed = lessonRequestSchema.safeParse(await readJson(req, lessonLimiter, who));
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The lesson request is missing or malformed.');
    const body = parsed.data;
    const chars = checkPages(body.pages, 1);
    const input: LessonInput = { ...body, taught: body.taught ?? [] };
    // The plan data comes from the browser, so it is checked against the page text again.
    if (checkLessonInput(input)) {
      throw new HttpError(400, 'invalid_request', 'The lesson plan does not match the document text.');
    }

    // The document id comes from the browser here. Only an id this server planned for this caller gets
    // its own budget; any other id shares one budget, so inventing ids does not unlock more requests.
    const courseKey = `${who.key}|${body.documentId}`;
    const budgetKey = plannedCourses.get(courseKey) ? courseKey : `${who.key}|unplanned`;
    // Everything that reaches the prompt or the stored lesson is part of the cache key.
    const digest = createHash('sha256')
      .update(JSON.stringify([body.documentId, body.documentName, body.pages, body.lesson, body.concepts, input.taught, lessonMaxTokens]))
      .digest('hex');
    const key = `${digest}|${provider.id}|${provider.model}|${LESSON_VERSION}`;
    const start: AiLogStart = {
      userId: user?.id ?? null,
      kind: 'lesson',
      provider: provider.id,
      model: provider.model,
      documentId: body.documentId,
      lessonTitle: body.lesson.title,
    };
    const respond = (result: LessonResult, cached: boolean): LessonGenerateResponse => ({
      ...result,
      cached,
      budget: budgets.use(budgetKey),
    });

    const cached = lessonCache.get(key);
    if (cached) {
      platform?.logAiOutcome(start, { cached: true });
      return respond(cached, true);
    }
    const flight = `${budgetKey}|${key}`;
    let pending = lessonsInFlight.get(flight);
    if (!pending) {
      const worstCase = estimateTokens(Math.min(chars, LESSON_CHAR_BUDGET) + PROMPT_OVERHEAD_CHARS) + lessonMaxTokens;
      pending = spend(who, start, budgetKey, worstCase, (onUsage) =>
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
    const [rawPath, rawQuery = ''] = (req.url ?? '/').split('?');
    const path = rawPath.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    const cors: Record<string, string> = {};
    let status = 500;
    try {
      const originOk = origin ? isAllowedOrigin(origin, allowedOrigins) : (options.allowNoOrigin ?? false);
      if (origin && originOk) {
        cors['access-control-allow-origin'] = origin;
        cors.vary = 'Origin';
      }
      if (!originOk) throw new HttpError(403, 'forbidden_origin', 'This site is not allowed to use the lesson service.');

      if (method === 'OPTIONS') {
        status = 204;
        res.writeHead(204, {
          ...cors,
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-max-age': '600',
        });
        res.end();
        return;
      }
      // Sessions travel in the Authorization header, never in a cookie, so another site cannot ride on them.
      const token = platform ? bearerToken(req) : undefined;
      const user = token ? platform?.accounts.userForToken(token) : undefined;

      if (method === 'GET' && path === '/api/health') {
        status = 200;
        const provider = activeProvider();
        const body: HealthResponse = { ok: true, provider: provider.id, model: provider.model, ...(platform ? { accounts: true } : {}) };
        send(res, 200, body, cors);
        return;
      }
      if (method === 'POST' && path === '/api/lessons/generate') {
        const body = await handleGenerate(req, user);
        status = 200;
        send(res, 200, body, cors);
        return;
      }
      if (method === 'POST' && path === '/api/lessons/plan') {
        const body = await handlePlan(req, user);
        status = 200;
        send(res, 200, body, cors);
        return;
      }
      if (method === 'POST' && path === '/api/lessons/lesson') {
        const body = await handleLesson(req, user);
        status = 200;
        send(res, 200, body, cors);
        return;
      }
      if (platformRoutes) {
        const result = await platformRoutes({
          req,
          method,
          path,
          query: new URLSearchParams(rawQuery),
          client: clientAddress(req, trustProxy),
          user,
          token: user ? token : undefined,
        });
        if (result) {
          status = result.status;
          send(res, result.status, result.body, cors);
          return;
        }
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
        log(`unexpected ${path}: ${err instanceof Error ? err.name : 'error'}`);
      }
      status = error.status;
      const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
      if (!res.headersSent) send(res, error.status, body, { ...cors, ...error.headers });
      else res.end();
    } finally {
      httpStats.total++;
      if (status >= 500) httpStats.serverErrors++;
      else if (status >= 400) httpStats.clientErrors++;
      // Method, path, status and timing only. Never document text, names or query strings.
      log(`${method} ${path} ${status} ${Date.now() - started}ms`);
    }
  };
}
