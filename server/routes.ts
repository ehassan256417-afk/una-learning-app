import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import {
  ACTIVITY_EVENT_TYPES,
  type AccountUser,
  type AdminOps,
  type AuthResponse,
  type PlatformSettings,
} from '../lib/account/contracts.ts';
import { AccountError, PASSWORD_MAX, PASSWORD_MIN, toAccountUser, type UserRow } from './accounts.ts';
import { HttpError, readJsonBody } from './http.ts';
import { courseSchema, progressSchema, settingsSchema, type Platform } from './platform.ts';
import { FailureLimiter, RateLimiter } from './security.ts';

/**
 * HTTP endpoints of the platform: accounts, a student's synced data, activity
 * measurement and the owner API.
 *
 * Access rules, enforced here and nowhere else:
 * - `/api/me/*` only ever reads or writes rows of the signed-in account. The
 *   account id comes from the session, never from the request.
 * - `/api/admin/*` needs the owner role, and every change (and every look at
 *   one student's record) is written to the audit log.
 */

export interface RouteContext {
  req: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  /** Address used for rate limits on endpoints that work without signing in. */
  client: string;
  user: UserRow | undefined;
  token: string | undefined;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

export interface RouteDeps {
  provider: () => { id: string; model: string };
  httpStats: { total: number; clientErrors: number; serverErrors: number };
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
const displayName = z.string().trim().min(1).max(40);
const browserId = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/);

const registerSchema = z.object({ email, name: displayName, password, inviteCode: z.string().trim().max(80).optional(), visitorId: browserId.optional() });
const loginSchema = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX), visitorId: browserId.optional() });
const passwordSchema = z.object({ current: z.string().min(1).max(PASSWORD_MAX), next: password });
const resetSchema = z.object({ email, code: z.string().trim().min(6).max(40), password });
const progressPutSchema = z.object({ baseRev: z.number().int().min(0), state: progressSchema });
const batchSchema = z.object({
  visitorId: browserId,
  visitId: browserId,
  referrer: z.string().max(80).optional(),
  activeMs: z.number().min(0).max(3_600_000),
  studyMs: z.number().min(0).max(3_600_000),
  events: z
    .array(
      z.object({
        type: z.enum(ACTIVITY_EVENT_TYPES),
        path: z.string().max(100).optional(),
        prev: z.string().max(100).optional(),
        value: z.number().min(0).max(1_000_000).optional(),
      }),
    )
    .max(30),
});
const userPatchSchema = z
  .object({ status: z.enum(['active', 'suspended']).optional(), beta: z.boolean().optional(), note: z.string().trim().max(500).optional() })
  .strict();
const inviteSchema = z.object({ note: z.string().trim().max(120).default(''), maxUses: z.number().int().min(1).max(500).default(1) });
const hideSchema = z.object({ hidden: z.boolean(), reason: z.string().trim().max(200).default('') });

const SMALL = 16_000;
const COURSE_BYTES = 2_000_000;
const PROGRESS_BYTES = 1_500_000;

function parse<T>(schema: z.ZodType<T>, json: unknown, message = 'The request is missing something or is malformed.'): T {
  const result = schema.safeParse(json);
  if (!result.success) throw new HttpError(400, 'invalid_request', message);
  return result.data;
}

const ACCOUNT_STATUS: Record<AccountError['code'], number> = {
  email_taken: 409,
  invalid_credentials: 401,
  suspended: 403,
  registration_closed: 403,
  invite_required: 403,
  invalid_invite: 403,
  invalid_reset: 400,
  not_found: 404,
};

export function createPlatformRoutes(platform: Platform, deps: RouteDeps) {
  const { accounts } = platform;
  // Sign-in attempts are limited per address and per account, so neither one address
  // guessing many accounts nor many addresses guessing one account gets far.
  const authByClient = new RateLimiter(30, 10 * 60_000);
  // Only failures count, so signing in normally never locks anyone out. One address gets 8 wrong
  // guesses per account; the wider per-account cap stops many addresses guessing one account.
  const guessesHere = new FailureLimiter(8, 15 * 60_000);
  const guessesAnywhere = new FailureLimiter(40, 15 * 60_000);
  // Activity reports: a browser sends one every 30 seconds at most, plus one per page opened.
  const eventsByClient = new RateLimiter(90, 10 * 60_000);
  const eventsByUser = new RateLimiter(240, 10 * 60_000);
  const dataByUser = new RateLimiter(900, 10 * 60_000);

  const limit = (gate: RateLimiter, key: string) => {
    const result = gate.check(key);
    if (!result.ok) {
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${result.retryAfterSec} seconds.`, {
        'retry-after': String(result.retryAfterSec),
      });
    }
  };

  /** Runs a password or code check with guess limits. A correct answer clears this address's count. */
  async function guarded<T>(emailKey: string, client: string, work: () => Promise<T>): Promise<T> {
    const here = `${emailKey}|${client}`;
    const wait = Math.max(guessesHere.blockedFor(here), guessesAnywhere.blockedFor(emailKey));
    if (wait > 0) {
      throw new HttpError(429, 'rate_limited', `Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} minutes.`, {
        'retry-after': String(wait),
      });
    }
    try {
      const result = await work();
      guessesHere.clear(here);
      return result;
    } catch (err) {
      if (err instanceof AccountError && (err.code === 'invalid_credentials' || err.code === 'invalid_reset')) {
        guessesHere.fail(here);
        guessesAnywhere.fail(emailKey);
      }
      throw err;
    }
  }

  const signedIn = (ctx: RouteContext): UserRow => {
    if (!ctx.user) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
    return ctx.user;
  };

  const owner = (ctx: RouteContext): UserRow => {
    const user = signedIn(ctx);
    if (user.role !== 'owner') throw new HttpError(403, 'forbidden', 'This area is for the site owner.');
    return user;
  };

  const session = (user: UserRow): AuthResponse => ({ token: accounts.createSession(user.id), user: toAccountUser(accounts.byId(user.id)!) });

  const rangeDays = (ctx: RouteContext) => {
    const n = Number(ctx.query.get('days'));
    return [1, 7, 14, 30, 90, 365].includes(n) ? n : 30;
  };

  /** A student other than the owner, looked up for an admin action. */
  const targetUser = (id: string): UserRow => {
    const user = accounts.byId(id);
    if (!user) throw new HttpError(404, 'not_found', 'No such account.');
    return user;
  };

  async function auth(ctx: RouteContext, action: string): Promise<RouteResult> {
    const { req } = ctx;
    if (action === 'register') {
      limit(authByClient, ctx.client);
      const body = parse(registerSchema, await readJsonBody(req, SMALL), 'Enter a name, a valid email and a password of at least 8 characters.');
      const user = await accounts.register({ ...body, mode: platform.settings().registration.mode });
      accounts.recordLogin(user.id);
      platform.recordEvent('registered', user.id, body.visitorId ?? '');
      return { status: 201, body: session(user) };
    }
    if (action === 'login') {
      limit(authByClient, ctx.client);
      const body = parse(loginSchema, await readJsonBody(req, SMALL), 'Enter your email and password.');
      const user = await guarded(body.email, ctx.client, () => accounts.authenticate(body.email, body.password));
      accounts.recordLogin(user.id);
      platform.recordEvent('login', user.id, body.visitorId ?? '');
      return { status: 200, body: session(user) };
    }
    if (action === 'reset') {
      limit(authByClient, ctx.client);
      const body = parse(resetSchema, await readJsonBody(req, SMALL), 'Enter your email, the reset code and a new password of at least 8 characters.');
      const user = await guarded(body.email, ctx.client, () => accounts.resetPassword(body.email, body.code, body.password));
      return { status: 200, body: session(user) };
    }
    if (action === 'logout') {
      if (ctx.token) accounts.endSession(ctx.token);
      return { status: 200, body: { ok: true } };
    }
    if (action === 'password') {
      const user = signedIn(ctx);
      const body = parse(passwordSchema, await readJsonBody(req, SMALL), 'The new password needs at least 8 characters.');
      await guarded(user.email, ctx.client, () => accounts.authenticate(user.email, body.current));
      await accounts.setPassword(user.id, body.next);
      // Every other device is signed out; this one stays.
      accounts.revokeSessions(user.id, ctx.token);
      return { status: 200, body: { ok: true } };
    }
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  async function me(ctx: RouteContext, rest: string[]): Promise<RouteResult> {
    const user = signedIn(ctx);
    limit(dataByUser, user.id);
    const { req, method } = ctx;
    const [area, id] = rest;

    if (!area && method === 'GET') return { status: 200, body: { user: toAccountUser(user) satisfies AccountUser } };
    if (!area && method === 'DELETE') {
      const body = parse(z.object({ password: z.string().min(1).max(PASSWORD_MAX) }), await readJsonBody(req, SMALL));
      if (user.role === 'owner') throw new HttpError(403, 'forbidden', 'The owner account cannot be deleted from the app.');
      await guarded(user.email, ctx.client, () => accounts.authenticate(user.email, body.password));
      accounts.deleteUser(user.id);
      return { status: 200, body: { ok: true } };
    }
    if (area === 'profile' && method === 'PATCH') {
      const body = parse(z.object({ name: displayName }), await readJsonBody(req, SMALL), 'Enter a name of up to 40 characters.');
      accounts.setName(user.id, body.name);
      return { status: 200, body: { user: toAccountUser(accounts.byId(user.id)!) } };
    }
    if (area === 'progress' && method === 'GET') return { status: 200, body: platform.getProgress(user.id) };
    if (area === 'progress' && method === 'PUT') {
      const body = parse(progressPutSchema, await readJsonBody(req, PROGRESS_BYTES), 'The progress data is malformed.');
      const result = platform.putProgress(user.id, body.baseRev, body.state);
      return result.ok ? { status: 200, body: { rev: result.rev } } : { status: 409, body: { rev: result.rev, state: result.state } };
    }
    if (area === 'courses' && !id && method === 'GET') return { status: 200, body: { courses: platform.listCourses(user.id) } };
    if (area === 'courses' && id) {
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id)) throw new HttpError(400, 'invalid_request', 'That is not a course id.');
      if (method === 'GET') {
        const course = platform.getCourse(user.id, id);
        if (!course) throw new HttpError(404, 'not_found', 'This course is not in your account.');
        return { status: 200, body: { updatedAt: course.updatedAt, course: JSON.parse(course.json) as unknown } };
      }
      if (method === 'PUT') {
        const json = await readJsonBody(req, COURSE_BYTES);
        const course = parse(courseSchema, (json as { course?: unknown } | null)?.course, 'The course data is malformed.');
        if (course.id !== id) throw new HttpError(400, 'invalid_request', 'The course id does not match the address.');
        const result = platform.putCourse(user.id, course, JSON.stringify(course));
        if (result.ok) return { status: 200, body: { updatedAt: result.updatedAt } };
        if (result.reason === 'hidden') throw new HttpError(403, 'forbidden', 'This course was taken offline by the site owner.');
        if (result.reason === 'storage') throw new HttpError(409, 'limit_reached', 'Your account storage is full. Delete a course to save another.');
        throw new HttpError(409, 'limit_reached', `Your account can hold ${platform.settings().limits.maxCoursesPerUser} courses. Delete one to save another.`);
      }
      if (method === 'DELETE') {
        platform.deleteCourse(user.id, id);
        return { status: 200, body: { ok: true } };
      }
    }
    if (area === 'stats' && method === 'GET') return { status: 200, body: platform.myStats(user.id) };
    if (area === 'export' && method === 'GET') return { status: 200, body: platform.exportUser(user) };
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  async function admin(ctx: RouteContext, rest: string[]): Promise<RouteResult> {
    const actor = owner(ctx);
    const { req, method, query } = ctx;
    const [area, a, b] = rest;
    const ok = (body: unknown): RouteResult => ({ status: 200, body });

    if (area === 'overview' && method === 'GET') return ok(platform.overview(rangeDays(ctx)));
    if (area === 'ai' && !a && method === 'GET') return ok(platform.aiReport(rangeDays(ctx), deps.provider()));
    if (area === 'ai' && a === 'failures' && b && method === 'POST') {
      const body = parse(z.object({ resolved: z.boolean() }), await readJsonBody(req, SMALL));
      if (!platform.resolveAiFailure(Number(b), body.resolved)) throw new HttpError(404, 'not_found', 'No such failed request.');
      platform.audit(actor, body.resolved ? 'ai.failure.resolve' : 'ai.failure.reopen', `request ${Number(b)}`);
      return ok({ ok: true });
    }

    if (area === 'users' && !a && method === 'GET') {
      const beta = query.get('beta');
      return ok({
        users: platform.listUsers({
          q: (query.get('q') ?? '').slice(0, 80) || undefined,
          status: query.get('status') ?? undefined,
          beta: beta === 'yes' ? true : beta === 'no' ? false : undefined,
        }),
      });
    }
    if (area === 'users' && a) {
      const target = targetUser(a);
      const protectedAccount = target.role === 'owner';
      if (!b && method === 'GET') {
        // Looking at one student's record is itself recorded.
        if (target.id !== actor.id) platform.audit(actor, 'user.view', target.email);
        return ok(platform.userDetail(target.id));
      }
      if (!b && method === 'PATCH') {
        const patch = parse(userPatchSchema, await readJsonBody(req, SMALL));
        if (protectedAccount && patch.status) throw new HttpError(403, 'forbidden', 'The owner account cannot be suspended.');
        platform.updateUser(target.id, patch);
        if (patch.status === 'suspended') accounts.revokeSessions(target.id);
        const changes = [
          patch.status && `status=${patch.status}`,
          patch.beta !== undefined && `beta=${patch.beta}`,
          patch.note !== undefined && 'note updated',
        ].filter(Boolean);
        platform.audit(actor, 'user.update', target.email, changes.join(', '));
        return ok(platform.userDetail(target.id));
      }
      if (!b && method === 'DELETE') {
        const body = parse(z.object({ confirmEmail: z.string().trim().toLowerCase().max(254) }), await readJsonBody(req, SMALL));
        if (protectedAccount) throw new HttpError(403, 'forbidden', 'The owner account cannot be deleted.');
        if (body.confirmEmail !== target.email) throw new HttpError(400, 'invalid_request', 'Type the account email exactly to confirm.');
        accounts.deleteUser(target.id);
        platform.audit(actor, 'user.delete', target.email);
        return ok({ ok: true });
      }
      if (b === 'reset-code' && method === 'POST') {
        if (protectedAccount && target.id !== actor.id) throw new HttpError(403, 'forbidden', 'Not allowed for this account.');
        const code = accounts.createResetCode(target.id);
        platform.audit(actor, 'user.reset_code', target.email, 'one-time code created');
        return ok(code);
      }
      if (b === 'sign-out' && method === 'POST') {
        const ended = accounts.revokeSessions(target.id, target.id === actor.id ? ctx.token : undefined);
        platform.audit(actor, 'user.sign_out', target.email, `${ended} session(s) ended`);
        return ok({ ended });
      }
    }

    if (area === 'courses' && !a && method === 'GET') {
      return ok({ courses: platform.listAllCourses({ q: (query.get('q') ?? '').slice(0, 80) || undefined, state: query.get('state') ?? undefined }) });
    }
    if (area === 'courses' && a && b) {
      const target = targetUser(a);
      if (method === 'PATCH') {
        const body = parse(hideSchema, await readJsonBody(req, SMALL));
        const reason = body.hidden ? body.reason || 'Taken offline by the owner' : null;
        if (!platform.setCourseHidden(target.id, b, reason)) throw new HttpError(404, 'not_found', 'No such course.');
        platform.audit(actor, body.hidden ? 'course.hide' : 'course.restore', `${target.email} / ${b}`, reason ?? '');
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        if (!platform.deleteCourse(target.id, b, true)) throw new HttpError(404, 'not_found', 'No such course.');
        platform.audit(actor, 'course.delete', `${target.email} / ${b}`);
        return ok({ ok: true });
      }
    }

    if (area === 'settings' && method === 'GET') return ok({ settings: platform.settings() });
    if (area === 'settings' && method === 'PUT') {
      const json = (await readJsonBody(req, SMALL)) as { settings?: unknown } | null;
      const next = parse(settingsSchema, json?.settings, 'One of the settings has a value that is not allowed.') as PlatformSettings;
      const before = platform.settings();
      platform.saveSettings(next);
      const changed = (Object.keys(next) as Array<keyof PlatformSettings>).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
      platform.audit(actor, 'settings.update', changed.join(', ') || 'no change', JSON.stringify(Object.fromEntries(changed.map((k) => [k, next[k]]))));
      return ok({ settings: platform.settings() });
    }

    if (area === 'invites' && !a && method === 'GET') return ok({ invites: platform.listInvites() });
    if (area === 'invites' && !a && method === 'POST') {
      const body = parse(inviteSchema, await readJsonBody(req, SMALL));
      const code = accounts.createInvite(body.note, body.maxUses);
      platform.audit(actor, 'invite.create', code, `${body.maxUses} use(s)${body.note ? `, ${body.note}` : ''}`);
      return ok({ code, invites: platform.listInvites() });
    }
    if (area === 'invites' && a && method === 'DELETE') {
      if (!platform.revokeInvite(a)) throw new HttpError(404, 'not_found', 'No such active invite.');
      platform.audit(actor, 'invite.revoke', a);
      return ok({ invites: platform.listInvites() });
    }

    if (area === 'audit' && method === 'GET') return ok({ entries: platform.auditLog() });

    const ops = (): AdminOps => ({
      startedAt: platform.startedAt,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      dbBytes: platform.dbBytes(),
      rows: platform.rowCounts(),
      provider: deps.provider(),
      http: { ...deps.httpStats },
      lastBackup: platform.backupInfo(),
    });
    if (area === 'ops' && !a && method === 'GET') return ok(ops());
    if (area === 'ops' && a === 'backup' && method === 'POST') {
      const made = platform.backup();
      platform.audit(actor, 'ops.backup', made.file);
      return ok(ops());
    }
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  /** Handles a platform request, or returns null when the path is not one of ours. */
  return async function handle(ctx: RouteContext): Promise<RouteResult | null> {
    const parts = ctx.path.split('/').filter(Boolean);
    if (parts[0] !== 'api') return null;
    const [, area, ...rest] = parts;
    try {
      if (area === 'public' && rest[0] === 'config' && ctx.method === 'GET') return { status: 200, body: platform.publicConfig() };
      if (area === 'auth' && ctx.method === 'POST' && rest.length === 1) return await auth(ctx, rest[0]);
      if (area === 'me') return await me(ctx, rest);
      if (area === 'admin') return await admin(ctx, rest);
      if (area === 'events' && ctx.method === 'POST' && rest.length === 0) {
        if (ctx.user) limit(eventsByUser, ctx.user.id);
        else limit(eventsByClient, ctx.client);
        const batch = parse(batchSchema, await readJsonBody(ctx.req, SMALL));
        platform.ingest(batch, ctx.user?.id ?? null);
        return { status: 202, body: { ok: true } };
      }
      return null;
    } catch (err) {
      if (err instanceof AccountError) throw new HttpError(ACCOUNT_STATUS[err.code], err.code, err.message);
      throw err;
    }
  };
}
