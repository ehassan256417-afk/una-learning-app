import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import type {
  AdminAi,
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  AuthResponse,
  MyStats,
  PlatformSettings,
} from '../lib/account/contracts.ts';
import type { PlanResponse } from '../lib/learning/contracts.ts';
import { createApp, type AppOptions } from '../server/app.ts';
import { Platform, type PlatformOptions } from '../server/platform.ts';
import { MockProvider } from '../server/providers/mock.ts';
import { ProviderError } from '../server/providers/types.ts';
import { expect } from './helpers/expect.ts';
import { extractSample } from './helpers/samples.ts';

const ORIGIN = 'http://localhost:3000';
const OWNER = 'owner@example.com';
const SETUP = 'setup-code-for-tests';
const PASSWORD = 'correct horse battery';

let server: Server | undefined;
let platform: Platform | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  platform?.close();
  server = undefined;
  platform = undefined;
});

interface Reply<T> {
  status: number;
  body: T;
}

async function start(options: Partial<AppOptions> = {}, platformOptions: Partial<PlatformOptions> = {}) {
  const clock = { t: Date.UTC(2026, 10, 14, 12, 0, 0) };
  platform = new Platform({ dbPath: ':memory:', ownerEmail: OWNER, ownerSetupCode: SETUP, now: () => clock.t, ...platformOptions });
  const app = createApp({ provider: new MockProvider(), allowedOrigins: [ORIGIN], platform, ...options });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call<T = Record<string, unknown>>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Reply<T>> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  const register = async (email: string, extra: Record<string, unknown> = {}) => {
    const r = await call<AuthResponse>('POST', '/api/auth/register', { body: { email, name: email.split('@')[0], password: PASSWORD, ...extra } });
    if (r.status !== 201) throw new Error(`register ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const registerOwner = () => register(OWNER, { inviteCode: SETUP });
  return { call, register, registerOwner, clock, platform: platform! };
}

const errorCode = (reply: Reply<unknown>) => (reply.body as { error?: { code?: string } }).error?.code;

const course = (id: string, title = 'Cell biology') => ({
  id,
  code: 'PDF',
  title,
  unitLabel: 'Your PDF',
  unitTitle: title,
  pages: 3,
  accent: 'purple',
  sections: [{ id: 's1', title: 'Lesson one' }],
  provenance: { kind: 'pdf', documentId: 'd'.repeat(64), citations: [] },
  generation: { provider: 'mock', model: 'm', createdAt: '2026-11-14', documentName: 'cells.pdf', report: { checked: 1, kept: 1, dropped: 0, reasons: [] } },
});

const progress = (xp: number) => ({
  version: 1,
  name: 'Sam',
  xp,
  streak: 1,
  lastStudyDay: '2026-11-14',
  todayXp: xp,
  completed: { 'c1/s1': { score: 2, total: 3, xp: 30 } },
  pdfSelected: true,
  review: { 'c1/s1/q1': { box: 0, due: 20000, seen: 2, lapses: 1 }, 'c1/s1/q2': { box: 4, due: 20040, seen: 5, lapses: 0 } },
});

const VISITOR = 'visitor-aaaaaaaaaaaa';
const VISIT = 'visit-bbbbbbbbbbbbbb';

describe('accounts', () => {
  it('registers, signs in, and signs out', async () => {
    const { call, register } = await start();
    const { token, user } = await register('sam@example.com');
    expect(user).toMatchObject({ email: 'sam@example.com', role: 'student', beta: false });

    expect((await call('GET', '/api/me', { token })).status).toBe(200);
    const again = await call<AuthResponse>('POST', '/api/auth/login', { body: { email: 'SAM@example.com ', password: PASSWORD } });
    expect(again.status).toBe(200);
    expect(again.body.token).not.toBe(token);

    expect((await call('POST', '/api/auth/logout', { token })).status).toBe(200);
    expect((await call('GET', '/api/me', { token })).status).toBe(401);
    // The other session is a different device and stays signed in.
    expect((await call('GET', '/api/me', { token: again.body.token })).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const { call, register } = await start();
    await register('sam@example.com');
    const wrong = await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: 'not the password' } });
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'not the password' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('never stores or returns the password', async () => {
    const { register, platform } = await start();
    const { user } = await register('sam@example.com');
    const row = platform.accounts.byId(user.id)!;
    expect(row.pw_hash.startsWith('scrypt$')).toBe(true);
    expect(row.pw_hash).not.toContain(PASSWORD);
    expect(JSON.stringify(user)).not.toContain('pw_hash');
    const sessions = platform.db.prepare('SELECT token_hash FROM auth_sessions').all() as Array<{ token_hash: string }>;
    expect(sessions[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a duplicate address and weak input', async () => {
    const { call, register } = await start();
    await register('sam@example.com');
    const dup = await call('POST', '/api/auth/register', { body: { email: 'Sam@Example.com', name: 'Sam', password: PASSWORD } });
    expect(dup.status).toBe(409);
    expect(errorCode(dup)).toBe('email_taken');
    const short = await call('POST', '/api/auth/register', { body: { email: 'a@example.com', name: 'A', password: 'short' } });
    expect(short.status).toBe(400);
    const bad = await call('POST', '/api/auth/register', { body: { email: 'not-an-email', name: 'A', password: PASSWORD } });
    expect(bad.status).toBe(400);
  });

  it('limits repeated sign-in attempts on one account', async () => {
    const { call, register } = await start();
    await register('sam@example.com');
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: `guess number ${i}` } })).status);
    }
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses[9]).toBe(429);
  });

  it('makes the owner only with the setup code, and never from the request', async () => {
    const { call, register, registerOwner } = await start();
    const noCode = await call('POST', '/api/auth/register', { body: { email: OWNER, name: 'Me', password: PASSWORD } });
    expect(noCode.status).toBe(403);
    const wrongCode = await call('POST', '/api/auth/register', { body: { email: OWNER, name: 'Me', password: PASSWORD, inviteCode: 'guess' } });
    expect(wrongCode.status).toBe(403);
    const sneaky = await call<AuthResponse>('POST', '/api/auth/register', {
      body: { email: 'eve@example.com', name: 'Eve', password: PASSWORD, role: 'owner' },
    });
    expect(sneaky.body.user.role).toBe('student');
    expect((await registerOwner()).user.role).toBe('owner');
    expect((await register('sam@example.com')).user.role).toBe('student');
  });

  it('has no owner at all when the server has no setup code', async () => {
    const { call } = await start({}, { ownerSetupCode: '' });
    const r = await call('POST', '/api/auth/register', { body: { email: OWNER, name: 'Me', password: PASSWORD, inviteCode: '' } });
    expect(r.status).toBe(403);
  });

  it('changes a password and signs the other devices out', async () => {
    const { call, register } = await start();
    const a = await register('sam@example.com');
    const b = (await call<AuthResponse>('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: PASSWORD } })).body;
    const wrong = await call('POST', '/api/auth/password', { token: a.token, body: { current: 'nope nope nope', next: 'a brand new password' } });
    expect(wrong.status).toBe(401);
    const changed = await call('POST', '/api/auth/password', { token: a.token, body: { current: PASSWORD, next: 'a brand new password' } });
    expect(changed.status).toBe(200);
    expect((await call('GET', '/api/me', { token: a.token })).status).toBe(200);
    expect((await call('GET', '/api/me', { token: b.token })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: PASSWORD } })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: 'a brand new password' } })).status).toBe(200);
  });

  it('expires a session after its lifetime', async () => {
    const { call, register, clock } = await start();
    const { token } = await register('sam@example.com');
    clock.t += 31 * 86_400_000;
    expect((await call('GET', '/api/me', { token })).status).toBe(401);
  });

  it('lets a student delete their own account and everything in it', async () => {
    const { call, register, platform } = await start();
    const { token, user } = await register('sam@example.com');
    await call('PUT', '/api/me/courses/c1', { token, body: { course: course('c1') } });
    await call('PUT', '/api/me/progress', { token, body: { baseRev: 0, state: progress(30) } });
    expect((await call('DELETE', '/api/me', { token, body: { password: 'wrong password!' } })).status).toBe(401);
    expect((await call('DELETE', '/api/me', { token, body: { password: PASSWORD } })).status).toBe(200);
    expect(platform.accounts.byId(user.id)).toBeUndefined();
    const count = (table: string) => (platform.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('courses')).toBe(0);
    expect(count('progress')).toBe(0);
    expect(count('auth_sessions')).toBe(0);
  });
});

describe('hardening', () => {
  it('never locks an account because of successful sign-ins, and forgives earlier mistakes after one', async () => {
    const { call, register } = await start();
    await register('sam@example.com');
    const login = (password: string) => call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password } });
    for (let i = 0; i < 12; i++) expect((await login(PASSWORD)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login('a wrong guess')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(200);
    // The count started again, so eight more mistakes are allowed before the block.
    for (let i = 0; i < 8; i++) expect((await login('a wrong guess')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(429);
  });

  it('limits password guesses on change-password and delete-account too', async () => {
    const { call, register } = await start();
    const { token } = await register('sam@example.com');
    for (let i = 0; i < 8; i++) {
      expect((await call('DELETE', '/api/me', { token, body: { password: `guess ${i} wrong` } })).status).toBe(401);
    }
    expect((await call('DELETE', '/api/me', { token, body: { password: PASSWORD } })).status).toBe(429);
    expect((await call('POST', '/api/auth/password', { token, body: { current: PASSWORD, next: 'another password 1' } })).status).toBe(429);
    expect((await call('GET', '/api/me', { token })).status).toBe(200);
  });

  it('says nothing about the setup code once the owner exists', async () => {
    const { call, registerOwner } = await start();
    await registerOwner();
    const body = { email: OWNER, name: 'Me', password: PASSWORD };
    const wrong = await call('POST', '/api/auth/register', { body: { ...body, inviteCode: 'a wrong guess' } });
    const right = await call('POST', '/api/auth/register', { body: { ...body, inviteCode: SETUP } });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toEqual(right.body);
  });

  it('ignores a setup code that is too short to be safe', async () => {
    const { call } = await start({}, { ownerSetupCode: 'short' });
    const r = await call('POST', '/api/auth/register', { body: { email: OWNER, name: 'Me', password: PASSWORD, inviteCode: 'short' } });
    expect(r.status).toBe(403);
  });

  it('does not reopen a suspended account with a reset code', async () => {
    const { call, register, registerOwner, platform } = await start();
    const sam = await register('sam@example.com');
    const owner = await registerOwner();
    const made = await call<{ code: string }>('POST', `/api/admin/users/${sam.user.id}/reset-code`, { token: owner.token });
    await call('PATCH', `/api/admin/users/${sam.user.id}`, { token: owner.token, body: { status: 'suspended' } });
    const before = platform.accounts.byId(sam.user.id)!.pw_hash;
    const r = await call('POST', '/api/auth/reset', { body: { email: 'sam@example.com', code: made.body.code, password: 'my new password 1' } });
    expect(r.status).toBe(400);
    expect(platform.accounts.byId(sam.user.id)!.pw_hash).toBe(before);
  });

  it('keeps a course the owner took offline when the student tries to delete it', async () => {
    const { call, register, registerOwner, platform } = await start();
    const sam = await register('sam@example.com');
    await call('PUT', '/api/me/courses/c1', { token: sam.token, body: { course: course('c1') } });
    const owner = await registerOwner();
    await call('PATCH', `/api/admin/courses/${sam.user.id}/c1`, { token: owner.token, body: { hidden: true, reason: 'Check' } });
    await call('DELETE', '/api/me/courses/c1', { token: sam.token });
    expect(platform.listAllCourses({ state: 'hidden' })).toHaveLength(1);
    // The owner can remove it.
    expect((await call('DELETE', `/api/admin/courses/${sam.user.id}/c1`, { token: owner.token })).status).toBe(200);
    expect(platform.listAllCourses({})).toHaveLength(0);
  });

  it('keeps at most ten devices signed in per account', async () => {
    const { call, register, clock, platform } = await start();
    const first = await register('sam@example.com');
    for (let i = 0; i < 11; i++) {
      clock.t += 1000;
      await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: PASSWORD } });
    }
    expect((platform.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get() as { n: number }).n).toBe(10);
    expect((await call('GET', '/api/me', { token: first.token })).status).toBe(401);
  });

  it('caps how many visits one browser can open in a day, and how much time a day can hold', async () => {
    const { call, register, clock, platform } = await start();
    const { token } = await register('sam@example.com');
    const visit = (n: number) => `visit-${String(n).padStart(14, '0')}`;
    for (let i = 0; i < 45; i++) {
      await call('POST', '/api/events', { token, body: { visitorId: VISITOR, visitId: visit(i), activeMs: 15_000, studyMs: 0, events: [{ type: 'page_view', path: '/' }] } });
    }
    const count = (table: string) => (platform.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('visits')).toBe(40);
    expect(count('events')).toBe(41);
    // Three tabs each reporting ten minutes every ten minutes for eight hours would be 25 hours:
    // a day never holds more than sixteen.
    for (let i = 0; i < 50; i++) {
      clock.t += 10 * 60_000;
      for (const v of [0, 1, 2]) {
        await call('POST', '/api/events', { token, body: { visitorId: VISITOR, visitId: visit(v), activeMs: 600_000, studyMs: 0, events: [] } });
      }
    }
    const held = platform.db.prepare('SELECT MAX(active_ms) AS n FROM activity').get() as { n: number };
    expect(held.n).toBe(16 * 60 * 60_000);
  });

  it('deletes activity past the retention period and keeps accounts', async () => {
    const { call, register, clock, platform } = await start();
    await register('sam@example.com');
    await call('POST', '/api/events', { body: { visitorId: VISITOR, visitId: VISIT, activeMs: 5_000, studyMs: 0, events: [{ type: 'page_view', path: '/' }] } });
    clock.t += 401 * 86_400_000;
    platform.prune();
    const count = (table: string) => (platform.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([count('events'), count('visits'), count('activity')]).toEqual([0, 0, 0]);
    expect(count('users')).toBe(1);
  });

  it('accepts only a plain address as the public support email', async () => {
    const { call, registerOwner } = await start();
    const owner = await registerOwner();
    const settings = (await call<{ settings: PlatformSettings }>('GET', '/api/admin/settings', { token: owner.token })).body.settings;
    const put = (supportEmail: string) =>
      call('PUT', '/api/admin/settings', { token: owner.token, body: { settings: { ...settings, site: { ...settings.site, supportEmail } } } });
    expect((await put('help@example.com?cc=other@example.com')).status).toBe(400);
    expect((await put('help@example.com')).status).toBe(200);
    expect((await put('')).status).toBe(200);
  });
});

describe('registration modes and invites', () => {
  it('needs a valid invite in invite mode and marks the account as a beta tester', async () => {
    const { call, registerOwner, register } = await start({}, { defaults: { registrationMode: 'invite' } });
    const owner = await registerOwner();
    const none = await call('POST', '/api/auth/register', { body: { email: 'a@example.com', name: 'A', password: PASSWORD } });
    expect(errorCode(none)).toBe('invite_required');
    const invite = await call<{ code: string }>('POST', '/api/admin/invites', { token: owner.token, body: { note: 'CIS 444', maxUses: 1 } });
    expect(invite.status).toBe(200);

    const first = await register('a@example.com', { inviteCode: invite.body.code });
    expect(first.user.beta).toBe(true);
    const second = await call('POST', '/api/auth/register', { body: { email: 'b@example.com', name: 'B', password: PASSWORD, inviteCode: invite.body.code } });
    expect(errorCode(second)).toBe('invalid_invite');
  });

  it('refuses everyone in closed mode', async () => {
    const { call } = await start({}, { defaults: { registrationMode: 'closed' } });
    const r = await call('POST', '/api/auth/register', { body: { email: 'a@example.com', name: 'A', password: PASSWORD } });
    expect(errorCode(r)).toBe('registration_closed');
  });

  it('resets a password with a one-time code from the owner', async () => {
    const { call, register, registerOwner } = await start();
    const owner = await registerOwner();
    const sam = await register('sam@example.com');
    const made = await call<{ code: string }>('POST', `/api/admin/users/${sam.user.id}/reset-code`, { token: owner.token });
    const body = { email: 'sam@example.com', code: made.body.code, password: 'my new password 1' };
    expect((await call('POST', '/api/auth/reset', { body: { ...body, code: 'wrong-code-123' } })).status).toBe(400);
    expect((await call('POST', '/api/auth/reset', { body })).status).toBe(200);
    // The code works once, and the old sessions are gone.
    expect((await call('POST', '/api/auth/reset', { body })).status).toBe(400);
    expect((await call('GET', '/api/me', { token: sam.token })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: 'my new password 1' } })).status).toBe(200);
  });
});

describe('a student sees only their own data', () => {
  it('keeps courses and progress per account', async () => {
    const { call, register } = await start();
    const sam = await register('sam@example.com');
    const eve = await register('eve@example.com');
    expect((await call('PUT', '/api/me/courses/c1', { token: sam.token, body: { course: course('c1') } })).status).toBe(200);
    expect((await call('PUT', '/api/me/progress', { token: sam.token, body: { baseRev: 0, state: progress(30) } })).status).toBe(200);

    expect((await call('GET', '/api/me/courses', { token: eve.token })).body).toEqual({ courses: [] });
    expect((await call('GET', '/api/me/courses/c1', { token: eve.token })).status).toBe(404);
    expect((await call('GET', '/api/me/progress', { token: eve.token })).body).toEqual({ rev: 0, state: null });
    expect((await call('DELETE', '/api/me/courses/c1', { token: eve.token })).status).toBe(200);
    // Eve's delete touched nothing of Sam's.
    const mine = await call<{ course: { title: string } }>('GET', '/api/me/courses/c1', { token: sam.token });
    expect(mine.body.course.title).toBe('Cell biology');
  });

  it('needs a session for every account endpoint', async () => {
    const { call } = await start();
    for (const [method, path] of [
      ['GET', '/api/me'],
      ['GET', '/api/me/progress'],
      ['GET', '/api/me/courses'],
      ['GET', '/api/me/stats'],
      ['GET', '/api/me/export'],
      ['GET', '/api/admin/overview'],
    ] as const) {
      expect((await call(method, path)).status).toBe(401);
      expect((await call(method, path, { token: 'x'.repeat(43) })).status).toBe(401);
    }
  });

  it('keeps students out of the owner API', async () => {
    const { call, register } = await start();
    const sam = await register('sam@example.com');
    for (const [method, path] of [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/users'],
      ['GET', `/api/admin/users/${sam.user.id}`],
      ['GET', '/api/admin/settings'],
      ['GET', '/api/admin/audit'],
      ['POST', '/api/admin/ops/backup'],
    ] as const) {
      const r = await call(method, path, { token: sam.token });
      expect(r.status).toBe(403);
      expect(errorCode(r)).toBe('forbidden');
    }
    const patch = await call('PATCH', `/api/admin/users/${sam.user.id}`, { token: sam.token, body: { beta: true } });
    expect(patch.status).toBe(403);
  });

  it('detects a second device saving over newer progress', async () => {
    const { call, register } = await start();
    const { token } = await register('sam@example.com');
    const first = await call<{ rev: number }>('PUT', '/api/me/progress', { token, body: { baseRev: 0, state: progress(30) } });
    expect(first.body.rev).toBe(1);
    const stale = await call<{ rev: number; state: { xp: number } }>('PUT', '/api/me/progress', { token, body: { baseRev: 0, state: progress(10) } });
    expect(stale.status).toBe(409);
    expect(stale.body.rev).toBe(1);
    expect(stale.body.state.xp).toBe(30);
    expect((await call<{ rev: number }>('PUT', '/api/me/progress', { token, body: { baseRev: 1, state: progress(60) } })).body.rev).toBe(2);
  });

  it('rejects malformed progress and course data', async () => {
    const { call, register } = await start();
    const { token } = await register('sam@example.com');
    expect((await call('PUT', '/api/me/progress', { token, body: { baseRev: 0, state: { ...progress(1), xp: 'lots' } } })).status).toBe(400);
    expect((await call('PUT', '/api/me/courses/c1', { token, body: { course: { ...course('c1'), provenance: { kind: 'demo' } } } })).status).toBe(400);
    expect((await call('PUT', '/api/me/courses/c1', { token, body: { course: course('other') } })).status).toBe(400);
  });

  it('enforces the course limit and drops a deleted course from the list', async () => {
    const { call, register, platform } = await start();
    platform.saveSettings({ ...platform.settings(), limits: { ...platform.settings().limits, maxCoursesPerUser: 2 } });
    const { token } = await register('sam@example.com');
    expect((await call('PUT', '/api/me/courses/c1', { token, body: { course: course('c1') } })).status).toBe(200);
    expect((await call('PUT', '/api/me/courses/c2', { token, body: { course: course('c2') } })).status).toBe(200);
    // Saving an existing course again is not a new course.
    expect((await call('PUT', '/api/me/courses/c2', { token, body: { course: course('c2', 'Renamed') } })).status).toBe(200);
    const third = await call('PUT', '/api/me/courses/c3', { token, body: { course: course('c3') } });
    expect(third.status).toBe(409);
    expect(errorCode(third)).toBe('limit_reached');
    await call('DELETE', '/api/me/courses/c1', { token });
    const list = await call<{ courses: Array<{ id: string }> }>('GET', '/api/me/courses', { token });
    expect(list.body.courses.map((c) => c.id)).toEqual(['c2']);
    expect((await call('PUT', '/api/me/courses/c3', { token, body: { course: course('c3') } })).status).toBe(200);
  });

  it('exports everything stored about the account', async () => {
    const { call, register } = await start();
    const { token } = await register('sam@example.com');
    await call('PUT', '/api/me/courses/c1', { token, body: { course: course('c1') } });
    const out = await call<{ account: { email: string }; courses: unknown[] }>('GET', '/api/me/export', { token });
    expect(out.body.account.email).toBe('sam@example.com');
    expect(out.body.courses).toHaveLength(1);
    expect(JSON.stringify(out.body)).not.toContain('scrypt');
  });
});

describe('AI requests with accounts', () => {
  const planBody = async () => {
    const doc = await extractSample('computing');
    return { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } };
  };

  it('needs a signed-in student and logs each request', async () => {
    const { call, register, registerOwner } = await start();
    const body = await planBody();
    expect((await call('POST', '/api/lessons/plan', { body })).status).toBe(401);

    const sam = await register('sam@example.com');
    const plan = await call<PlanResponse>('POST', '/api/lessons/plan', { token: sam.token, body });
    expect(plan.status).toBe(200);
    expect(plan.body.cached).toBe(false);
    // The same document again is answered from the cache and is not counted as a request.
    expect((await call<PlanResponse>('POST', '/api/lessons/plan', { token: sam.token, body })).body.cached).toBe(true);

    const owner = await registerOwner();
    const ai = (await call<AdminAi>('GET', '/api/admin/ai?days=7', { token: owner.token })).body;
    expect(ai.totals).toMatchObject({ requests: 1, ok: 1, failed: 0, cached: 1 });
    expect(ai.totals.promptTokens).toBeGreaterThan(0);
    expect(ai.byUser[0]).toMatchObject({ email: 'sam@example.com', requests: 1 });
    expect(ai.byKind[0]).toMatchObject({ kind: 'plan', requests: 1 });
    expect(ai.today.requests).toBe(1);
  });

  it('stops a student at their daily limit without touching the provider', async () => {
    const { call, register, registerOwner, platform } = await start();
    platform.saveSettings({ ...platform.settings(), limits: { ...platform.settings().limits, userDailyAiRequests: 1 } });
    const sam = await register('sam@example.com');
    const eve = await register('eve@example.com');
    const one = await planBody();
    const other = await extractSample('biology');
    const two = { document: { name: other.name, pageCount: other.pageCount, pages: other.pages } };

    expect((await call('POST', '/api/lessons/plan', { token: sam.token, body: one })).status).toBe(200);
    const refused = await call('POST', '/api/lessons/plan', { token: sam.token, body: two });
    expect(refused.status).toBe(429);
    expect(errorCode(refused)).toBe('limit_reached');
    // Another student has their own allowance.
    expect((await call('POST', '/api/lessons/plan', { token: eve.token, body: two })).status).toBe(200);

    const owner = await registerOwner();
    const ai = (await call<AdminAi>('GET', '/api/admin/ai', { token: owner.token })).body;
    expect(ai.totals).toMatchObject({ requests: 2, refused: 1 });
    expect(ai.failures[0]).toMatchObject({ status: 'refused', errorCode: 'limit_reached', userEmail: 'sam@example.com' });
  });

  it('records a failed request with its reason', async () => {
    const failing = { id: 'mock', model: 'broken', generate: () => Promise.reject(new Error('boom')) };
    const { call, register, registerOwner } = await start({ provider: failing });
    const sam = await register('sam@example.com');
    expect((await call('POST', '/api/lessons/plan', { token: sam.token, body: await planBody() })).status).toBeGreaterThanOrEqual(500);
    const owner = await registerOwner();
    const ai = (await call<AdminAi>('GET', '/api/admin/ai', { token: owner.token })).body;
    expect(ai.totals).toMatchObject({ requests: 1, ok: 0, failed: 1 });
    expect(ai.failures[0]).toMatchObject({ status: 'failed', model: 'broken' });
  });

  it('logs a provider outage once, then refuses without calling the provider or counting the request', async () => {
    const down = {
      id: 'zro',
      model: 'm',
      calls: 0,
      generate: () => {
        down.calls++;
        return Promise.reject(new ProviderError('unavailable', 'The AI provider is temporarily unavailable (HTTP 503).'));
      },
    };
    const { call, register, registerOwner } = await start({ provider: down });
    const sam = await register('sam@example.com');
    const body = await planBody();

    const first = await call('POST', '/api/lessons/plan', { token: sam.token, body });
    expect(first.status).toBe(503);
    expect(errorCode(first)).toBe('provider_unavailable');
    const second = await call('POST', '/api/lessons/plan', { token: sam.token, body });
    expect(second.status).toBe(503);
    expect(errorCode(second)).toBe('provider_unavailable');
    expect(down.calls).toBe(1);

    const owner = await registerOwner();
    const ai = (await call<AdminAi>('GET', '/api/admin/ai', { token: owner.token })).body;
    // One real attempt, with the upstream status kept for the owner; the second click is a refusal and is not counted.
    expect(ai.totals).toMatchObject({ requests: 1, ok: 0, failed: 1, refused: 1 });
    expect(ai.today.requests).toBe(1);
    expect(ai.failures.map((f) => `${f.status} ${f.errorCode}`).sort()).toEqual(['failed provider_unavailable', 'refused provider_unavailable']);
    expect(ai.totals.promptTokens).toBe(0);
  });

  it('switches generation off from the settings', async () => {
    const { call, register, platform } = await start();
    platform.saveSettings({ ...platform.settings(), features: { ...platform.settings().features, generation: false } });
    const sam = await register('sam@example.com');
    const r = await call('POST', '/api/lessons/plan', { token: sam.token, body: await planBody() });
    expect(r.status).toBe(503);
    expect(errorCode(r)).toBe('feature_disabled');
  });

  it('uses the model the owner picked', async () => {
    const asked: string[] = [];
    const { call, register, platform } = await start({
      providerFor: (model) => {
        asked.push(model);
        const inner = new MockProvider();
        return { id: inner.id, model, generate: (req) => inner.generate(req) };
      },
    });
    platform.saveSettings({ ...platform.settings(), ai: { ...platform.settings().ai, model: 'other-model-2' } });
    const sam = await register('sam@example.com');
    const plan = await call<PlanResponse>('POST', '/api/lessons/plan', { token: sam.token, body: await planBody() });
    expect(plan.body.model).toBe('other-model-2');
    expect(asked).toEqual(['other-model-2']);
  });
});

describe('measured activity', () => {
  const batch = (extra: Record<string, unknown> = {}) => ({
    visitorId: VISITOR,
    visitId: VISIT,
    activeMs: 20_000,
    studyMs: 5_000,
    events: [{ type: 'page_view', path: '/' }],
    ...extra,
  });

  it('counts visits, visitors and page views from real events', async () => {
    const { call, registerOwner } = await start();
    await call('POST', '/api/events', { body: batch() });
    await call('POST', '/api/events', { body: batch({ events: [{ type: 'page_view', path: '/register', prev: '/' }] }) });
    await call('POST', '/api/events', {
      body: batch({ visitorId: 'visitor-cccccccccccc', visitId: 'visit-dddddddddddddd', events: [{ type: 'page_view', path: '/' }] }),
    });
    const owner = await registerOwner();
    const o = (await call<AdminOverview>('GET', '/api/admin/overview?days=7', { token: owner.token })).body;
    expect(o.totals).toMatchObject({ visits: 2, visitors: 2, pageViews: 3, signups: 1 });
    expect(o.daily).toHaveLength(7);
    expect(o.daily[6]).toMatchObject({ visits: 2, pageViews: 3 });
    expect(o.topPages[0]).toMatchObject({ path: '/', views: 2, visitors: 2 });
    expect(o.transitions[0]).toEqual({ from: '/', to: '/register', count: 1 });
    expect(o.funnel.map((f) => f.count).slice(0, 2)).toEqual([2, 1]);
    expect(o.previous.visits).toBe(0);
  });

  it('never credits more active time than really passed', async () => {
    const { call, register, clock, platform } = await start();
    const sam = await register('sam@example.com');
    // A first batch claims an hour; a new visit can hold at most fifteen seconds.
    await call('POST', '/api/events', { token: sam.token, body: batch({ activeMs: 3_600_000, studyMs: 3_600_000 }) });
    let visit = platform.db.prepare('SELECT active_ms, study_ms FROM visits WHERE id = ?').get(VISIT) as { active_ms: number; study_ms: number };
    expect(visit.active_ms).toBe(15_000);
    // Thirty seconds later it claims ten minutes; only the elapsed time (plus a little slack) counts.
    clock.t += 30_000;
    await call('POST', '/api/events', { token: sam.token, body: batch({ activeMs: 600_000, studyMs: 900_000, events: [] }) });
    visit = platform.db.prepare('SELECT active_ms, study_ms FROM visits WHERE id = ?').get(VISIT) as { active_ms: number; study_ms: number };
    expect(visit.active_ms).toBe(15_000 + 35_000);
    expect(visit.study_ms).toBe(15_000 + 35_000);
    const stats = (await call<MyStats>('GET', '/api/me/stats', { token: sam.token })).body;
    expect(stats.totalActiveMin).toBe(0.8);
    expect(stats.sessions).toBe(1);
  });

  it('ignores another browser trying to add to a visit, and unknown event types', async () => {
    const { call, platform } = await start();
    await call('POST', '/api/events', { body: batch() });
    await call('POST', '/api/events', { body: batch({ visitorId: 'visitor-zzzzzzzzzzzz' }) });
    expect((platform.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(1);
    const bad = await call('POST', '/api/events', { body: batch({ events: [{ type: 'made_up', path: '/' }] }) });
    expect(bad.status).toBe(400);
    // A path that is not a plain route is stored empty, never as given.
    await call('POST', '/api/events', { body: batch({ events: [{ type: 'page_view', path: '/my?c=secret<script>' }] }) });
    const paths = (platform.db.prepare('SELECT path FROM events').all() as Array<{ path: string }>).map((r) => r.path);
    expect(paths).toEqual(['/', '']);
  });

  it('counts a returning visitor', async () => {
    const { call, registerOwner, clock } = await start();
    await call('POST', '/api/events', { body: batch() });
    clock.t += 2 * 86_400_000;
    await call('POST', '/api/events', { body: batch({ visitId: 'visit-eeeeeeeeeeeeee' }) });
    await call('POST', '/api/events', { body: batch({ visitorId: 'visitor-cccccccccccc', visitId: 'visit-dddddddddddddd' }) });
    const owner = await registerOwner();
    const o = (await call<AdminOverview>('GET', '/api/admin/overview?days=30', { token: owner.token })).body;
    expect(o.retention).toEqual({ newVisitors: 2, returned: 1 });
  });
});

describe('owner dashboard', () => {
  it('shows one student with their learning, time and AI numbers', async () => {
    const { call, register, registerOwner } = await start();
    const sam = await register('sam@example.com');
    await call('PUT', '/api/me/progress', { token: sam.token, body: { baseRev: 0, state: progress(30) } });
    await call('PUT', '/api/me/courses/c1', { token: sam.token, body: { course: course('c1') } });
    await call('POST', '/api/events', {
      token: sam.token,
      body: { visitorId: VISITOR, visitId: VISIT, activeMs: 12_000, studyMs: 6_000, events: [{ type: 'lesson_started', path: '/my/lesson' }] },
    });
    const owner = await registerOwner();

    const list = (await call<{ users: AdminUserRow[] }>('GET', '/api/admin/users?q=sam', { token: owner.token })).body.users;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: 'sam@example.com', courses: 1, loginCount: 1, status: 'active' });

    const d = (await call<AdminUserDetail>('GET', `/api/admin/users/${sam.user.id}`, { token: owner.token })).body;
    expect(d.learning).toMatchObject({ xp: 30, lessonsStarted: 1, lessonsCompleted: 1, quizCorrect: 2, quizTotal: 3, itemsTracked: 2, weak: 1, strong: 1 });
    expect(d).toMatchObject({ visits: 1, activeMin: 0.2, studyMin: 0.1, signedInDevices: 1 });
    expect(d.courseList[0]).toMatchObject({ title: 'Cell biology', documentName: 'cells.pdf', lessonsReady: 1 });
    expect(d.daily).toHaveLength(30);
    // The owner sees numbers and titles, not the lessons themselves.
    expect(JSON.stringify(d)).not.toContain('Lesson one');
    expect(JSON.stringify(d)).not.toContain('scrypt');

    const audit = (await call<{ entries: Array<{ action: string; target: string }> }>('GET', '/api/admin/audit', { token: owner.token })).body.entries;
    expect(audit[0]).toMatchObject({ action: 'user.view', target: 'sam@example.com' });
  });

  it('suspends an account, which signs it out, and records the change', async () => {
    const { call, register, registerOwner } = await start();
    const sam = await register('sam@example.com');
    const owner = await registerOwner();
    const r = await call<AdminUserDetail>('PATCH', `/api/admin/users/${sam.user.id}`, { token: owner.token, body: { status: 'suspended', beta: true } });
    expect(r.body).toMatchObject({ status: 'suspended', beta: true });
    expect((await call('GET', '/api/me', { token: sam.token })).status).toBe(401);
    const login = await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: PASSWORD } });
    expect(login.status).toBe(403);
    expect(errorCode(login)).toBe('suspended');

    await call('PATCH', `/api/admin/users/${sam.user.id}`, { token: owner.token, body: { status: 'active' } });
    expect((await call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: PASSWORD } })).status).toBe(200);
    const audit = (await call<{ entries: Array<{ action: string; detail: string }> }>('GET', '/api/admin/audit', { token: owner.token })).body.entries;
    expect(audit.map((e) => e.action)).toEqual(['user.update', 'user.update']);
    expect(audit[1].detail).toBe('status=suspended, beta=true');
  });

  it('protects the owner account from being suspended or deleted', async () => {
    const { call, registerOwner } = await start();
    const owner = await registerOwner();
    expect((await call('PATCH', `/api/admin/users/${owner.user.id}`, { token: owner.token, body: { status: 'suspended' } })).status).toBe(403);
    expect((await call('DELETE', `/api/admin/users/${owner.user.id}`, { token: owner.token, body: { confirmEmail: OWNER } })).status).toBe(403);
    expect((await call('DELETE', '/api/me', { token: owner.token, body: { password: PASSWORD } })).status).toBe(403);
  });

  it('deletes an account only when the email is typed to confirm', async () => {
    const { call, register, registerOwner, platform } = await start();
    const sam = await register('sam@example.com');
    const owner = await registerOwner();
    expect((await call('DELETE', `/api/admin/users/${sam.user.id}`, { token: owner.token, body: { confirmEmail: 'wrong@example.com' } })).status).toBe(400);
    expect((await call('DELETE', `/api/admin/users/${sam.user.id}`, { token: owner.token, body: { confirmEmail: 'sam@example.com' } })).status).toBe(200);
    expect(platform.accounts.byId(sam.user.id)).toBeUndefined();
  });

  it('takes a course offline for its student and puts it back', async () => {
    const { call, register, registerOwner } = await start();
    const sam = await register('sam@example.com');
    await call('PUT', '/api/me/courses/c1', { token: sam.token, body: { course: course('c1') } });
    const owner = await registerOwner();
    const hide = await call('PATCH', `/api/admin/courses/${sam.user.id}/c1`, { token: owner.token, body: { hidden: true, reason: 'Wrong material' } });
    expect(hide.status).toBe(200);
    expect((await call('GET', '/api/me/courses', { token: sam.token })).body).toEqual({ courses: [] });
    // A browser that still has a copy cannot put it back.
    expect((await call('PUT', '/api/me/courses/c1', { token: sam.token, body: { course: course('c1') } })).status).toBe(403);
    await call('PATCH', `/api/admin/courses/${sam.user.id}/c1`, { token: owner.token, body: { hidden: false } });
    expect((await call<{ courses: unknown[] }>('GET', '/api/me/courses', { token: sam.token })).body.courses).toHaveLength(1);
  });

  it('saves settings, shows the public part to visitors, and rejects bad values', async () => {
    const { call, registerOwner } = await start();
    const owner = await registerOwner();
    const current = (await call<{ settings: PlatformSettings }>('GET', '/api/admin/settings', { token: owner.token })).body.settings;
    const next: PlatformSettings = {
      ...current,
      registration: { mode: 'invite' },
      announcement: { active: true, text: 'Maintenance on Friday night.', tone: 'warning' },
      ai: { ...current.ai, inputPricePerMTok: 0.5, outputPricePerMTok: 1.5 },
    };
    expect((await call('PUT', '/api/admin/settings', { token: owner.token, body: { settings: next } })).status).toBe(200);
    const pub = (await call<Record<string, unknown>>('GET', '/api/public/config')).body;
    expect(pub).toMatchObject({ registration: 'invite', announcement: { text: 'Maintenance on Friday night.', tone: 'warning' } });
    // Limits, prices and the model name are not public.
    expect(JSON.stringify(pub)).not.toContain('Price');
    expect(JSON.stringify(pub)).not.toContain('limits');

    const bad = { ...next, limits: { ...next.limits, userDailyAiRequests: -5 } };
    expect((await call('PUT', '/api/admin/settings', { token: owner.token, body: { settings: bad } })).status).toBe(400);
    const extra = { ...next, ai: { ...next.ai, model: 'x; DROP TABLE users' } };
    expect((await call('PUT', '/api/admin/settings', { token: owner.token, body: { settings: extra } })).status).toBe(400);

    const audit = (await call<{ entries: Array<{ action: string; target: string }> }>('GET', '/api/admin/audit', { token: owner.token })).body.entries;
    expect(audit[0]).toMatchObject({ action: 'settings.update', target: 'registration, announcement, ai' });
  });

  it('estimates cost only when prices are set', async () => {
    const { call, register, registerOwner, platform } = await start();
    const sam = await register('sam@example.com');
    const doc = await extractSample('computing');
    await call('POST', '/api/lessons/plan', { token: sam.token, body: { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } } });
    const owner = await registerOwner();
    expect((await call<AdminAi>('GET', '/api/admin/ai', { token: owner.token })).body.totals.estCostUsd).toBeNull();
    platform.saveSettings({ ...platform.settings(), ai: { model: '', inputPricePerMTok: 1, outputPricePerMTok: 2 } });
    const totals = (await call<AdminAi>('GET', '/api/admin/ai', { token: owner.token })).body.totals;
    const expected = Math.round(((totals.promptTokens * 1 + totals.outputTokens * 2) / 1_000_000) * 10_000) / 10_000;
    expect(totals.estCostUsd).toBe(expected);
  });
});
