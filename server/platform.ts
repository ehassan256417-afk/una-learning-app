import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type {
  ActivityBatch,
  AdminAi,
  AdminCourseRow,
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  AiRequestRow,
  AiTotals,
  AuditRow,
  CourseIndexEntry,
  DailyPoint,
  DayActivity,
  InviteRow,
  MyStats,
  PlatformSettings,
  ProgressEnvelope,
  PublicConfig,
  TrafficTotals,
} from '../lib/account/contracts.ts';
import { Accounts, type AccountsOptions, type UserRow } from './accounts.ts';
import { dayOf, inTransaction, openDb, type Db } from './db.ts';

/**
 * Everything the platform keeps: settings, each student's saved learning
 * data, measured activity, the AI request log, the audit log, and the queries
 * behind the owner dashboard.
 *
 * Numbers shown to the owner are counted from rows written here as things
 * happen. Nothing is sampled or made up; where a number is an estimate (unique
 * visitors, cost) the contract says so and the dashboard labels it.
 */

const DAY_MS = 86_400_000;

/*
 * Bounds on what browsers can make the platform store. Activity reports need no
 * sign-in, so every one of them has a ceiling: without these a script could fill
 * the disk that also holds the students' accounts, or report hours of fake study.
 */
/** Activity older than this is deleted. The dashboard looks back 365 days at most. */
const RETENTION_DAYS = 400;
/** Time a brand-new visit may claim in its first report. */
const NEW_VISIT_WINDOW_MS = 15_000;
const MAX_VISITS_PER_VISITOR_DAY = 40;
const MAX_EVENTS_PER_VISITOR_DAY = 3_000;
/** Active time one account (or one anonymous browser) can hold for a single day. */
const MAX_ACTIVE_MS_PER_DAY = 16 * 60 * 60_000;
/** Event rows accepted per day from visitors who are not signed in, across the whole site. */
const MAX_ANONYMOUS_EVENTS_PER_DAY = 60_000;
/** Bytes of courses one account may store. */
const MAX_COURSE_BYTES_PER_USER = 30_000_000;
const BACKUPS_KEPT = 14;
const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const settingsSchema = z
  .object({
    registration: z.object({ mode: z.enum(['open', 'invite', 'closed']) }).strict(),
    limits: z
      .object({
        userDailyAiRequests: int(0, 10_000),
        dailyAiRequests: int(0, 100_000),
        courseMaxRequests: int(3, 60),
        courseMaxTokens: int(10_000, 2_000_000),
        maxCoursesPerUser: int(1, 200),
      })
      .strict(),
    features: z
      .object({ generation: z.boolean(), pptxUpload: z.boolean(), spacedReview: z.boolean(), sampleCourses: z.boolean() })
      .strict(),
    announcement: z.object({ active: z.boolean(), text: z.string().trim().max(300), tone: z.enum(['info', 'warning']) }).strict(),
    ai: z
      .object({
        model: z.string().trim().regex(/^[A-Za-z0-9._:/-]{0,80}$/),
        inputPricePerMTok: z.number().min(0).max(1000),
        outputPricePerMTok: z.number().min(0).max(1000),
      })
      .strict(),
    site: z
      .object({
        tagline: z.string().trim().max(160),
        // Empty, or a plain address: it becomes a mailto link on the public page.
        supportEmail: z
          .string()
          .trim()
          .max(120)
          .regex(/^$|^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/),
      })
      .strict(),
    learning: z.object({ reviewSessionSize: int(5, 50), dailyGoalXp: int(10, 1000) }).strict(),
  })
  .strict();

export const DEFAULT_SETTINGS: PlatformSettings = {
  registration: { mode: 'open' },
  limits: { userDailyAiRequests: 40, dailyAiRequests: 200, courseMaxRequests: 12, courseMaxTokens: 120_000, maxCoursesPerUser: 20 },
  features: { generation: true, pptxUpload: true, spacedReview: true, sampleCourses: true },
  announcement: { active: false, text: '', tone: 'info' },
  ai: { model: '', inputPricePerMTok: 0, outputPricePerMTok: 0 },
  site: { tagline: 'Turn your course PDFs and slides into short lessons, quizzes and spaced review.', supportEmail: '' },
  learning: { reviewSessionSize: 15, dailyGoalXp: 50 },
};

const reviewRecord = z.object({ box: int(0, 20), due: int(0, 1_000_000), seen: int(0, 1_000_000), lapses: int(0, 1_000_000) });
const sectionResult = z.object({ score: int(0, 10_000), total: int(0, 10_000), xp: int(0, 100_000), demo: z.boolean().optional() });

/** The saved progress of one student. Mirrors `ProgressState` in the browser. */
export const progressSchema = z.object({
  version: z.literal(1),
  name: z.string().max(60),
  xp: int(0, 100_000_000),
  streak: int(0, 100_000),
  lastStudyDay: z.string().max(12).nullable(),
  todayXp: int(0, 100_000_000),
  completed: z.record(z.string().max(200), sectionResult),
  pdfSelected: z.boolean(),
  review: z.record(z.string().max(300), reviewRecord),
});

/** Only the outline of a course is checked; its lessons are opaque to the platform and returned only to their owner. */
export const courseSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    title: z.string().max(300),
    sections: z.array(z.unknown()).max(80),
    provenance: z.object({ kind: z.literal('pdf') }).passthrough(),
    sourceKind: z.enum(['pdf', 'pptx']).optional(),
    generation: z.object({ documentName: z.string().max(300) }).passthrough().optional(),
    plan: z.object({ lessons: z.array(z.unknown()).max(80) }).passthrough().optional(),
    lessonStates: z.array(z.object({ status: z.string().max(20) }).passthrough()).max(80).optional(),
  })
  .passthrough();

const SAFE_PATH = /^\/[a-z0-9/:_-]{0,80}$/;
const cleanPath = (path: string | undefined) => (path && SAFE_PATH.test(path) ? path : '');

export interface AiLogStart {
  userId: string | null;
  kind: 'plan' | 'lesson' | 'course';
  provider: string;
  model: string;
  documentId?: string;
  lessonTitle?: string;
}

export interface AiLogEnd {
  status: 'ok' | 'failed' | 'refused';
  promptTokens?: number;
  outputTokens?: number;
  tokensEstimated?: boolean;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface PlatformOptions extends AccountsOptions {
  /** File path of the database, or `:memory:` for tests. */
  dbPath: string;
  /** Starting values for settings the owner has not changed yet (from the server's environment). */
  defaults?: {
    registrationMode?: PlatformSettings['registration']['mode'];
    dailyAiRequests?: number;
    courseMaxRequests?: number;
    courseMaxTokens?: number;
  };
}

interface AuditActor {
  id: string;
  email: string;
}

const minutes = (ms: number) => Math.round(ms / 6000) / 10;
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class Platform {
  readonly db: Db;
  readonly accounts: Accounts;
  readonly startedAt: number;
  private dbPath: string;
  private now: () => number;
  private defaults: PlatformSettings;
  private cachedSettings: PlatformSettings | null = null;
  private lastBackup: { file: string; at: number } | null = null;
  private anonymous = { day: '', events: 0 };
  private prunedDay = '';

  constructor(options: PlatformOptions) {
    this.dbPath = options.dbPath;
    this.db = openDb(options.dbPath);
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.accounts = new Accounts(this.db, options);
    const d = options.defaults ?? {};
    this.defaults = {
      ...DEFAULT_SETTINGS,
      registration: { mode: d.registrationMode ?? DEFAULT_SETTINGS.registration.mode },
      limits: {
        ...DEFAULT_SETTINGS.limits,
        dailyAiRequests: d.dailyAiRequests ?? DEFAULT_SETTINGS.limits.dailyAiRequests,
        courseMaxRequests: d.courseMaxRequests ?? DEFAULT_SETTINGS.limits.courseMaxRequests,
        courseMaxTokens: d.courseMaxTokens ?? DEFAULT_SETTINGS.limits.courseMaxTokens,
      },
    };
    // Requests that were running when the server last stopped never finished.
    this.db
      .prepare("UPDATE ai_requests SET status = 'failed', error_code = 'interrupted', error_message = 'The server stopped during this request.' WHERE status = 'running'")
      .run();
    this.prune();
  }

  /** Deletes activity and AI log rows past the retention period. Runs at start and once per day. */
  prune() {
    const t = this.now();
    this.prunedDay = dayOf(t);
    const cutoff = dayOf(t - RETENTION_DAYS * DAY_MS);
    for (const table of ['events', 'visits', 'activity', 'ai_requests']) {
      this.db.prepare(`DELETE FROM ${table} WHERE day < ?`).run(cutoff);
    }
  }

  close() {
    this.db.close();
  }

  /* ---------- settings ---------- */

  settings(): PlatformSettings {
    if (this.cachedSettings) return this.cachedSettings;
    const row = this.db.prepare("SELECT json FROM settings WHERE key = 'platform'").get() as { json: string } | undefined;
    let stored: Partial<PlatformSettings> = {};
    try {
      stored = row ? (JSON.parse(row.json) as Partial<PlatformSettings>) : {};
    } catch {
      stored = {};
    }
    // Section by section, so a setting added in a later version gets its default.
    const merged = Object.fromEntries(
      (Object.keys(this.defaults) as Array<keyof PlatformSettings>).map((k) => [k, { ...this.defaults[k], ...(stored[k] ?? {}) }]),
    );
    const parsed = settingsSchema.safeParse(merged);
    this.cachedSettings = parsed.success ? (parsed.data as PlatformSettings) : this.defaults;
    return this.cachedSettings;
  }

  saveSettings(next: PlatformSettings) {
    this.db
      .prepare("INSERT INTO settings (key, json, updated_at) VALUES ('platform', ?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
      .run(JSON.stringify(next), this.now());
    this.cachedSettings = null;
  }

  publicConfig(): PublicConfig {
    const s = this.settings();
    return {
      registration: s.registration.mode,
      features: s.features,
      announcement: s.announcement.active && s.announcement.text ? { text: s.announcement.text, tone: s.announcement.tone } : null,
      site: s.site,
      learning: s.learning,
    };
  }

  /* ---------- a student's saved data ---------- */

  getProgress(userId: string): ProgressEnvelope {
    const row = this.db.prepare('SELECT rev, json FROM progress WHERE user_id = ?').get(userId) as { rev: number; json: string } | undefined;
    return row ? { rev: row.rev, state: JSON.parse(row.json) as unknown } : { rev: 0, state: null };
  }

  /**
   * Saves progress if `baseRev` is still the latest revision. Otherwise nothing
   * is written and the latest copy is returned, so the browser can merge and try
   * again: two devices can never silently overwrite each other.
   */
  putProgress(userId: string, baseRev: number, state: unknown): { ok: true; rev: number } | ({ ok: false } & ProgressEnvelope) {
    return inTransaction(this.db, () => {
      const current = this.getProgress(userId);
      if (current.rev !== baseRev) return { ok: false as const, ...current };
      const rev = current.rev + 1;
      this.db
        .prepare(
          'INSERT INTO progress (user_id, rev, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET rev = excluded.rev, json = excluded.json, updated_at = excluded.updated_at',
        )
        .run(userId, rev, JSON.stringify(state), this.now());
      return { ok: true as const, rev };
    });
  }

  listCourses(userId: string): CourseIndexEntry[] {
    const rows = this.db
      .prepare('SELECT id, updated_at FROM courses WHERE user_id = ? AND deleted_at IS NULL AND hidden_reason IS NULL ORDER BY updated_at DESC')
      .all(userId) as Array<{ id: string; updated_at: number }>;
    return rows.map((r) => ({ id: r.id, updatedAt: r.updated_at }));
  }

  getCourse(userId: string, id: string): { json: string; updatedAt: number } | undefined {
    const row = this.db
      .prepare('SELECT json, updated_at FROM courses WHERE user_id = ? AND id = ? AND deleted_at IS NULL AND hidden_reason IS NULL')
      .get(userId, id) as { json: string; updated_at: number } | undefined;
    return row ? { json: row.json, updatedAt: row.updated_at } : undefined;
  }

  putCourse(
    userId: string,
    course: z.infer<typeof courseSchema>,
    json: string,
  ): { ok: true; updatedAt: number } | { ok: false; reason: 'limit' | 'hidden' | 'storage' } {
    return inTransaction(this.db, () => {
      const existing = this.db.prepare('SELECT deleted_at, hidden_reason, created_at FROM courses WHERE user_id = ? AND id = ?').get(userId, course.id) as
        | { deleted_at: number | null; hidden_reason: string | null; created_at: number }
        | undefined;
      // A course the owner took offline cannot be put back by a browser that still has a copy.
      if (existing?.hidden_reason != null) return { ok: false as const, reason: 'hidden' as const };
      if (!existing || existing.deleted_at != null) {
        const count = (this.db.prepare('SELECT COUNT(*) AS n FROM courses WHERE user_id = ? AND deleted_at IS NULL').get(userId) as { n: number }).n;
        if (count >= this.settings().limits.maxCoursesPerUser) return { ok: false as const, reason: 'limit' as const };
      }
      const others = (this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM courses WHERE user_id = ? AND id <> ?').get(userId, course.id) as { n: number }).n;
      if (others + Buffer.byteLength(json) > MAX_COURSE_BYTES_PER_USER) return { ok: false as const, reason: 'storage' as const };
      const t = this.now();
      const failed = (course.lessonStates ?? []).filter((s) => s.status === 'failed').length;
      this.db
        .prepare(
          `INSERT INTO courses (user_id, id, title, document_name, source_kind, lessons_ready, lessons_planned, lessons_failed, bytes, json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, id) DO UPDATE SET title = excluded.title, document_name = excluded.document_name,
             source_kind = excluded.source_kind, lessons_ready = excluded.lessons_ready, lessons_planned = excluded.lessons_planned,
             lessons_failed = excluded.lessons_failed, bytes = excluded.bytes, json = excluded.json, updated_at = excluded.updated_at, deleted_at = NULL`,
        )
        .run(
          userId,
          course.id,
          course.title,
          course.generation?.documentName ?? '',
          course.sourceKind ?? 'pdf',
          course.sections.length,
          course.plan?.lessons.length ?? course.sections.length,
          failed,
          Buffer.byteLength(json),
          json,
          existing?.created_at ?? t,
          t,
        );
      return { ok: true as const, updatedAt: t };
    });
  }

  /**
   * Deletes a course. The student's other devices drop it at their next sync because it is no longer
   * in the account's list. A student cannot delete a course the owner took offline: that one is kept
   * for the owner to look at, and only the owner can remove it (`includeHidden`).
   */
  deleteCourse(userId: string, id: string, includeHidden = false): boolean {
    const result = this.db
      .prepare(`DELETE FROM courses WHERE user_id = ? AND id = ?${includeHidden ? '' : ' AND hidden_reason IS NULL'}`)
      .run(userId, id);
    return result.changes === 1;
  }

  myStats(userId: string): MyStats {
    const s = this.settings();
    const days = this.activityDays(userId, 14);
    const total = this.db.prepare('SELECT COALESCE(SUM(active_ms), 0) AS a, COALESCE(SUM(study_ms), 0) AS s FROM activity WHERE user_key = ?').get(userId) as { a: number; s: number };
    return {
      days,
      totalActiveMin: minutes(total.a),
      totalStudyMin: minutes(total.s),
      sessions: (this.db.prepare('SELECT COUNT(*) AS n FROM visits WHERE user_id = ?').get(userId) as { n: number }).n,
      aiRequestsToday: this.aiCountToday(userId),
      aiDailyLimit: s.limits.userDailyAiRequests,
      courses: this.listCourses(userId).length,
      courseLimit: s.limits.maxCoursesPerUser,
    };
  }

  /** Everything stored about one account, for the student's own export. */
  exportUser(user: UserRow) {
    const courses = this.db.prepare('SELECT id, json, created_at, updated_at FROM courses WHERE user_id = ? AND deleted_at IS NULL').all(user.id) as Array<{
      id: string;
      json: string;
      created_at: number;
      updated_at: number;
    }>;
    return {
      exportedAt: new Date(this.now()).toISOString(),
      account: { email: user.email, name: user.name, createdAt: user.created_at, lastLoginAt: user.last_login_at, betaTester: user.beta === 1 },
      progress: this.getProgress(user.id).state,
      courses: courses.map((c) => ({ id: c.id, createdAt: c.created_at, updatedAt: c.updated_at, course: JSON.parse(c.json) as unknown })),
      activity: this.db.prepare('SELECT day, active_ms AS activeMs, study_ms AS studyMs FROM activity WHERE user_key = ? ORDER BY day').all(user.id),
      aiRequests: this.db
        .prepare('SELECT ts, kind, model, prompt_tokens AS promptTokens, output_tokens AS outputTokens, status FROM ai_requests WHERE user_id = ? ORDER BY ts')
        .all(user.id),
    };
  }

  /* ---------- measured activity ---------- */

  /** Records a server-side fact (a registration or a sign-in) as an event. */
  recordEvent(type: 'registered' | 'login', userId: string, visitorId: string) {
    const t = this.now();
    this.db
      .prepare('INSERT INTO events (ts, day, visitor_id, visit_id, user_id, type) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t, dayOf(t), visitorId, '', userId, type);
  }

  /**
   * Stores one batch from a browser. Time is capped by the wall-clock time since
   * the previous batch of the same visit, so a browser cannot report more active
   * time than actually passed.
   */
  ingest(batch: ActivityBatch, userId: string | null) {
    const t = this.now();
    const day = dayOf(t);
    if (day !== this.prunedDay) this.prune();
    if (this.anonymous.day !== day) this.anonymous = { day, events: 0 };
    // Past the daily ceiling, reports from visitors who are not signed in are dropped: statistics for the
    // rest of that day undercount, and the database stays a safe size.
    if (!userId && this.anonymous.events >= MAX_ANONYMOUS_EVENTS_PER_DAY) return;
    inTransaction(this.db, () => {
      const visit = this.db.prepare('SELECT visitor_id, last_at FROM visits WHERE id = ?').get(batch.visitId) as
        | { visitor_id: string; last_at: number }
        | undefined;
      // A visit id belongs to the browser that created it.
      if (visit && visit.visitor_id !== batch.visitorId) return;
      const count = (sql: string) => (this.db.prepare(sql).get(batch.visitorId, day) as { n: number }).n;
      if (!visit && count('SELECT COUNT(*) AS n FROM visits WHERE visitor_id = ? AND day = ?') >= MAX_VISITS_PER_VISITOR_DAY) return;
      const room = MAX_EVENTS_PER_VISITOR_DAY - count('SELECT COUNT(*) AS n FROM events WHERE visitor_id = ? AND day = ?');
      const events = batch.events.slice(0, Math.max(0, room));
      if (!userId) this.anonymous.events += Math.max(1, events.length);
      const views = events.filter((e) => e.type === 'page_view');
      const window = visit ? Math.min(t - visit.last_at + 5_000, 10 * 60_000) : NEW_VISIT_WINDOW_MS;
      // Starting new visits (or new browser ids) cannot add up to more than a day can hold.
      const held = userId
        ? (this.db.prepare('SELECT COALESCE(SUM(active_ms), 0) AS n FROM activity WHERE user_key = ? AND day = ?').get(userId, day) as { n: number }).n
        : (this.db.prepare("SELECT COALESCE(SUM(active_ms), 0) AS n FROM activity WHERE visitor_id = ? AND day = ? AND user_key = ''").get(batch.visitorId, day) as { n: number }).n;
      const active = Math.max(0, Math.min(Math.round(batch.activeMs), window, MAX_ACTIVE_MS_PER_DAY - held));
      const study = Math.max(0, Math.min(Math.round(batch.studyMs), active));
      if (!visit) {
        this.db
          .prepare(
            'INSERT INTO visits (id, visitor_id, user_id, started_at, last_at, day, active_ms, study_ms, page_views, entry_path, referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(batch.visitId, batch.visitorId, userId, t, t, day, active, study, views.length, cleanPath(views[0]?.path), (batch.referrer ?? '').slice(0, 80));
      } else {
        this.db
          .prepare('UPDATE visits SET last_at = ?, active_ms = active_ms + ?, study_ms = study_ms + ?, page_views = page_views + ?, user_id = COALESCE(?, user_id) WHERE id = ?')
          .run(t, active, study, views.length, userId, batch.visitId);
      }
      if (active > 0) {
        this.db
          .prepare(
            `INSERT INTO activity (day, visitor_id, user_key, active_ms, study_ms) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (day, visitor_id, user_key) DO UPDATE SET active_ms = active_ms + excluded.active_ms, study_ms = study_ms + excluded.study_ms`,
          )
          .run(day, batch.visitorId, userId ?? '', active, study);
      }
      const insert = this.db.prepare('INSERT INTO events (ts, day, visitor_id, visit_id, user_id, type, path, prev_path, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const e of events) {
        insert.run(t, day, batch.visitorId, batch.visitId, userId, e.type, cleanPath(e.path), cleanPath(e.prev), Math.max(0, Math.min(Math.round(e.value ?? 0), 1_000_000)));
      }
    });
  }

  private activityDays(userId: string, days: number): DayActivity[] {
    const since = dayOf(this.now() - (days - 1) * DAY_MS);
    const rows = this.db
      .prepare('SELECT day, SUM(active_ms) AS a, SUM(study_ms) AS s FROM activity WHERE user_key = ? AND day >= ? GROUP BY day')
      .all(userId, since) as Array<{ day: string; a: number; s: number }>;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    return this.dayList(days).map((day) => ({ day, activeMin: minutes(byDay.get(day)?.a ?? 0), studyMin: minutes(byDay.get(day)?.s ?? 0) }));
  }

  private dayList(days: number): string[] {
    const t = this.now();
    return Array.from({ length: days }, (_, i) => dayOf(t - (days - 1 - i) * DAY_MS));
  }

  /* ---------- AI request log ---------- */

  /** AI requests that reached (or are reaching) the provider today, for one student or for everyone. */
  aiCountToday(userId?: string): number {
    const day = dayOf(this.now());
    const sql = "SELECT COUNT(*) AS n FROM ai_requests WHERE day = ? AND cached = 0 AND status <> 'refused'";
    const row = userId ? this.db.prepare(`${sql} AND user_id = ?`).get(day, userId) : this.db.prepare(sql).get(day);
    return (row as { n: number }).n;
  }

  /** Records a request as running, which also counts it against the daily limits straight away. */
  beginAi(start: AiLogStart): number {
    const t = this.now();
    const result = this.db
      .prepare("INSERT INTO ai_requests (ts, day, user_id, kind, provider, model, status, document_id, lesson_title) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)")
      .run(t, dayOf(t), start.userId, start.kind, start.provider, start.model, start.documentId ?? '', (start.lessonTitle ?? '').slice(0, 160));
    return Number(result.lastInsertRowid);
  }

  finishAi(id: number, end: AiLogEnd) {
    this.db
      .prepare(
        'UPDATE ai_requests SET status = ?, prompt_tokens = ?, output_tokens = ?, tokens_estimated = ?, duration_ms = ?, error_code = ?, error_message = ? WHERE id = ?',
      )
      .run(
        end.status,
        Math.max(0, Math.round(end.promptTokens ?? 0)),
        Math.max(0, Math.round(end.outputTokens ?? 0)),
        end.tokensEstimated ? 1 : 0,
        Math.max(0, Math.round(end.durationMs)),
        end.errorCode ?? '',
        (end.errorMessage ?? '').slice(0, 300),
        id,
      );
  }

  /** A request answered from the cache, or refused before reaching the provider: logged, never counted as spend. */
  logAiOutcome(start: AiLogStart, outcome: { cached: true } | { refused: string; message: string }) {
    const t = this.now();
    const cached = 'cached' in outcome;
    this.db
      .prepare(
        'INSERT INTO ai_requests (ts, day, user_id, kind, provider, model, status, cached, error_code, error_message, document_id, lesson_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        t,
        dayOf(t),
        start.userId,
        start.kind,
        start.provider,
        start.model,
        cached ? 'ok' : 'refused',
        cached ? 1 : 0,
        cached ? '' : outcome.refused,
        cached ? '' : outcome.message.slice(0, 300),
        start.documentId ?? '',
        (start.lessonTitle ?? '').slice(0, 160),
      );
  }

  private estCost(promptTokens: number, outputTokens: number): number | null {
    const { inputPricePerMTok: i, outputPricePerMTok: o } = this.settings().ai;
    if (i === 0 && o === 0) return null;
    return Math.round(((promptTokens * i + outputTokens * o) / 1_000_000) * 10_000) / 10_000;
  }

  /* ---------- audit ---------- */

  audit(actor: AuditActor, action: string, target = '', detail = '') {
    this.db
      .prepare('INSERT INTO audit (ts, actor_id, actor_email, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.now(), actor.id, actor.email, action, target.slice(0, 200), detail.slice(0, 500));
  }

  auditLog(limit = 200): AuditRow[] {
    return this.db
      .prepare('SELECT id, ts, actor_email AS actorEmail, action, target, detail FROM audit ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as AuditRow[];
  }

  /* ---------- owner dashboard: traffic ---------- */

  private trafficTotals(fromDay: string, toDay: string): TrafficTotals {
    const one = <T>(sql: string, ...args: string[]) => this.db.prepare(sql).get(...args) as T;
    const v = one<{ visits: number; visitors: number; ms: number }>(
      'SELECT COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS visitors, COALESCE(SUM(active_ms), 0) AS ms FROM visits WHERE day >= ? AND day <= ?',
      fromDay,
      toDay,
    );
    const count = (type: string) =>
      one<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE type = ? AND day >= ? AND day <= ?', type, fromDay, toDay).n;
    const a = one<{ users: number; a: number; s: number }>(
      "SELECT COUNT(DISTINCT CASE WHEN user_key <> '' THEN user_key END) AS users, COALESCE(SUM(active_ms), 0) AS a, COALESCE(SUM(study_ms), 0) AS s FROM activity WHERE day >= ? AND day <= ?",
      fromDay,
      toDay,
    );
    return {
      visits: v.visits,
      visitors: v.visitors,
      pageViews: count('page_view'),
      signups: count('registered'),
      logins: count('login'),
      activeUsers: a.users,
      activeMin: minutes(a.a),
      studyMin: minutes(a.s),
      avgVisitMin: v.visits ? minutes(v.ms / v.visits) : 0,
    };
  }

  overview(rangeDays: number): AdminOverview {
    const t = this.now();
    const today = dayOf(t);
    const from = dayOf(t - (rangeDays - 1) * DAY_MS);
    const prevTo = dayOf(t - rangeDays * DAY_MS);
    const prevFrom = dayOf(t - (2 * rangeDays - 1) * DAY_MS);
    const all = <T>(sql: string, ...args: Array<string | number>) => this.db.prepare(sql).all(...args) as T[];
    const one = <T>(sql: string, ...args: Array<string | number>) => this.db.prepare(sql).get(...args) as T;

    const visitRows = all<{ day: string; visits: number; visitors: number }>(
      'SELECT day, COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS visitors FROM visits WHERE day >= ? GROUP BY day',
      from,
    );
    const eventRows = all<{ day: string; type: string; n: number }>(
      "SELECT day, type, COUNT(*) AS n FROM events WHERE day >= ? AND type IN ('page_view', 'registered', 'login') GROUP BY day, type",
      from,
    );
    const activityRows = all<{ day: string; users: number; a: number; s: number }>(
      "SELECT day, COUNT(DISTINCT CASE WHEN user_key <> '' THEN user_key END) AS users, SUM(active_ms) AS a, SUM(study_ms) AS s FROM activity WHERE day >= ? GROUP BY day",
      from,
    );
    const visitBy = new Map(visitRows.map((r) => [r.day, r]));
    const actBy = new Map(activityRows.map((r) => [r.day, r]));
    const ev = (day: string, type: string) => eventRows.find((r) => r.day === day && r.type === type)?.n ?? 0;
    const daily: DailyPoint[] = this.dayList(rangeDays).map((day) => ({
      day,
      visits: visitBy.get(day)?.visits ?? 0,
      visitors: visitBy.get(day)?.visitors ?? 0,
      pageViews: ev(day, 'page_view'),
      signups: ev(day, 'registered'),
      logins: ev(day, 'login'),
      activeUsers: actBy.get(day)?.users ?? 0,
      activeMin: minutes(actBy.get(day)?.a ?? 0),
      studyMin: minutes(actBy.get(day)?.s ?? 0),
    }));

    const funnelStep = (where: string) =>
      one<{ n: number }>(`SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE day >= ? AND visitor_id <> '' AND ${where}`, from).n;
    const activeUsers = (days: number) =>
      one<{ n: number }>("SELECT COUNT(DISTINCT user_key) AS n FROM activity WHERE user_key <> '' AND day >= ?", dayOf(t - (days - 1) * DAY_MS)).n;
    const retention = one<{ fresh: number; returned: number }>(
      `SELECT COUNT(*) AS fresh, COALESCE(SUM(CASE WHEN days > 1 THEN 1 ELSE 0 END), 0) AS returned
       FROM (SELECT visitor_id, MIN(day) AS first, COUNT(DISTINCT day) AS days FROM visits GROUP BY visitor_id) WHERE first >= ?`,
      from,
    );

    return {
      rangeDays,
      generatedAt: t,
      totals: this.trafficTotals(from, today),
      previous: this.trafficTotals(prevFrom, prevTo),
      allTime: {
        users: one<{ n: number }>('SELECT COUNT(*) AS n FROM users').n,
        visitors: one<{ n: number }>('SELECT COUNT(DISTINCT visitor_id) AS n FROM visits').n,
        visits: one<{ n: number }>('SELECT COUNT(*) AS n FROM visits').n,
        courses: one<{ n: number }>('SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NULL').n,
        lessonsCompleted: one<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE type = 'lesson_completed'").n,
      },
      live: {
        activeNow: one<{ n: number }>('SELECT COUNT(*) AS n FROM visits WHERE last_at > ?', t - 5 * 60_000).n,
        activeUsersToday: activeUsers(1),
        activeUsers7d: activeUsers(7),
        activeUsers30d: activeUsers(30),
      },
      daily,
      topPages: all(
        "SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM events WHERE type = 'page_view' AND day >= ? AND path <> '' GROUP BY path ORDER BY views DESC LIMIT 12",
        from,
      ),
      transitions: all(
        "SELECT prev_path AS \"from\", path AS \"to\", COUNT(*) AS count FROM events WHERE type = 'page_view' AND day >= ? AND prev_path <> '' AND path <> '' AND prev_path <> path GROUP BY prev_path, path ORDER BY count DESC LIMIT 15",
        from,
      ),
      // The last page of each visit, beside how many visits saw that page at all.
      exits: all(
        `SELECT x.path AS path, x.exits AS exits, v.visits AS visits FROM
           (SELECT path, COUNT(*) AS exits FROM (SELECT visit_id, path, MAX(id) FROM events WHERE type = 'page_view' AND day >= ? AND visit_id <> '' GROUP BY visit_id) GROUP BY path) x
           JOIN (SELECT path, COUNT(DISTINCT visit_id) AS visits FROM events WHERE type = 'page_view' AND day >= ? GROUP BY path) v ON v.path = x.path
         WHERE x.path <> '' ORDER BY x.exits DESC LIMIT 10`,
        from,
        from,
      ),
      funnel: [
        { step: 'visit', label: 'Visited the site', count: funnelStep("type = 'page_view'") },
        { step: 'signup_page', label: 'Opened the sign-up page', count: funnelStep("type = 'page_view' AND path = '/register'") },
        { step: 'registered', label: 'Created an account', count: funnelStep("type = 'registered'") },
        { step: 'generation_started', label: 'Started creating lessons', count: funnelStep("type = 'generation_started'") },
        { step: 'generation_finished', label: 'Got at least one lesson', count: funnelStep("type = 'generation_finished' AND value > 0") },
        { step: 'lesson_started', label: 'Started a lesson', count: funnelStep("type = 'lesson_started'") },
        { step: 'lesson_completed', label: 'Completed a lesson', count: funnelStep("type = 'lesson_completed'") },
      ],
      retention: { newVisitors: retention.fresh, returned: retention.returned },
      referrers: all(
        "SELECT CASE WHEN referrer = '' THEN 'Direct or unknown' ELSE referrer END AS referrer, COUNT(*) AS visits FROM visits WHERE day >= ? GROUP BY referrer ORDER BY visits DESC LIMIT 8",
        from,
      ),
    };
  }

  /* ---------- owner dashboard: users ---------- */

  private static USER_SELECT = `
    SELECT u.id, u.email, u.name, u.role, u.status, u.beta, u.created_at, u.last_login_at, u.last_seen_at, u.login_count, u.note, u.invite_code,
      (SELECT COUNT(*) FROM courses c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS courses,
      (SELECT COALESCE(SUM(active_ms), 0) FROM activity a WHERE a.user_key = u.id) AS active_ms,
      (SELECT COALESCE(SUM(study_ms), 0) FROM activity a WHERE a.user_key = u.id) AS study_ms,
      (SELECT COUNT(*) FROM ai_requests r WHERE r.user_id = u.id AND r.cached = 0 AND r.status <> 'refused') AS ai_requests
    FROM users u`;

  private toUserRow(r: Record<string, unknown>): AdminUserRow {
    return {
      id: r.id as string,
      email: r.email as string,
      name: r.name as string,
      role: r.role as AdminUserRow['role'],
      status: r.status as AdminUserRow['status'],
      beta: r.beta === 1,
      createdAt: r.created_at as number,
      lastLoginAt: r.last_login_at as number | null,
      lastSeenAt: r.last_seen_at as number | null,
      loginCount: r.login_count as number,
      courses: r.courses as number,
      activeMin: minutes(r.active_ms as number),
      studyMin: minutes(r.study_ms as number),
      aiRequests: r.ai_requests as number,
      note: r.note as string,
    };
  }

  listUsers(filter: { q?: string; status?: string; beta?: boolean }): AdminUserRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.q) {
      where.push("(u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
      args.push(likeTerm(filter.q), likeTerm(filter.q));
    }
    if (filter.status === 'active' || filter.status === 'suspended') {
      where.push('u.status = ?');
      args.push(filter.status);
    }
    if (filter.beta !== undefined) {
      where.push('u.beta = ?');
      args.push(filter.beta ? 1 : 0);
    }
    const sql = `${Platform.USER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.created_at DESC LIMIT 500`;
    return (this.db.prepare(sql).all(...args) as Array<Record<string, unknown>>).map((r) => this.toUserRow(r));
  }

  userDetail(userId: string): AdminUserDetail | undefined {
    const raw = this.db.prepare(`${Platform.USER_SELECT} WHERE u.id = ?`).get(userId) as Record<string, unknown> | undefined;
    if (!raw) return undefined;
    const one = <T>(sql: string, ...args: Array<string | number>) => this.db.prepare(sql).get(...args) as T;
    const visits = one<{ n: number; ms: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(active_ms), 0) AS ms FROM visits WHERE user_id = ?', userId);
    const eventCount = (type: string) => one<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND type = ?', userId, type).n;

    // Learning numbers come from the student's own saved progress.
    const parsed = progressSchema.safeParse(this.getProgress(userId).state);
    const progress = parsed.success ? parsed.data : null;
    const done = progress ? Object.values(progress.completed).filter((r) => !r.demo) : [];
    const records = progress ? Object.values(progress.review) : [];

    const ai = one<{ requests: number; ok: number; failed: number; p: number; o: number }>(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(status = 'ok'), 0) AS ok, COALESCE(SUM(status = 'failed'), 0) AS failed,
         COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(output_tokens), 0) AS o
       FROM ai_requests WHERE user_id = ? AND cached = 0 AND status <> 'refused'`,
      userId,
    );
    return {
      ...this.toUserRow(raw),
      inviteCode: raw.invite_code as string | null,
      signedInDevices: one<{ n: number }>('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ? AND expires_at > ?', userId, this.now()).n,
      visits: visits.n,
      avgVisitMin: visits.n ? minutes(visits.ms / visits.n) : 0,
      learning: {
        xp: progress?.xp ?? 0,
        streak: progress?.streak ?? 0,
        lastStudyDay: progress?.lastStudyDay ?? null,
        lessonsStarted: eventCount('lesson_started'),
        lessonsCompleted: done.length,
        quizCorrect: done.reduce((n, r) => n + r.score, 0),
        quizTotal: done.reduce((n, r) => n + r.total, 0),
        reviewSessions: eventCount('review_completed'),
        itemsTracked: records.length,
        weak: records.filter((r) => r.box === 0).length,
        learning: records.filter((r) => r.box >= 1 && r.box <= 3).length,
        strong: records.filter((r) => r.box >= 4).length,
      },
      ai: {
        requests: ai.requests,
        ok: ai.ok,
        failed: ai.failed,
        cached: one<{ n: number }>('SELECT COUNT(*) AS n FROM ai_requests WHERE user_id = ? AND cached = 1', userId).n,
        promptTokens: ai.p,
        outputTokens: ai.o,
        estCostUsd: this.estCost(ai.p, ai.o),
        today: this.aiCountToday(userId),
        dailyLimit: this.settings().limits.userDailyAiRequests,
      },
      courseList: this.listAllCourses({ userId }),
      daily: this.activityDays(userId, 30),
      recentAi: this.aiRows('r.user_id = ?', [userId], 20),
    };
  }

  updateUser(userId: string, patch: { status?: 'active' | 'suspended'; beta?: boolean; note?: string }) {
    if (patch.status) this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(patch.status, userId);
    if (patch.beta !== undefined) this.db.prepare('UPDATE users SET beta = ? WHERE id = ?').run(patch.beta ? 1 : 0, userId);
    if (patch.note !== undefined) this.db.prepare('UPDATE users SET note = ? WHERE id = ?').run(patch.note, userId);
  }

  /* ---------- owner dashboard: courses ---------- */

  listAllCourses(filter: { q?: string; userId?: string; state?: string }): AdminCourseRow[] {
    const where = ['c.deleted_at IS NULL'];
    const args: Array<string | number> = [];
    if (filter.userId) {
      where.push('c.user_id = ?');
      args.push(filter.userId);
    }
    if (filter.q) {
      where.push("(c.title LIKE ? ESCAPE '\\' OR c.document_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
      args.push(likeTerm(filter.q), likeTerm(filter.q), likeTerm(filter.q));
    }
    if (filter.state === 'hidden') where.push('c.hidden_reason IS NOT NULL');
    if (filter.state === 'incomplete') where.push('(c.lessons_failed > 0 OR c.lessons_ready < c.lessons_planned)');
    const rows = this.db
      .prepare(
        `SELECT c.user_id, u.email, c.id, c.title, c.document_name, c.source_kind, c.lessons_ready, c.lessons_planned, c.lessons_failed,
           c.bytes, c.created_at, c.updated_at, c.hidden_reason
         FROM courses c JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 500`,
      )
      .all(...args) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      userId: r.user_id as string,
      userEmail: r.email as string,
      id: r.id as string,
      title: r.title as string,
      documentName: r.document_name as string,
      sourceKind: r.source_kind as string,
      lessonsReady: r.lessons_ready as number,
      lessonsPlanned: r.lessons_planned as number,
      lessonsFailed: r.lessons_failed as number,
      bytes: r.bytes as number,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      hidden: r.hidden_reason != null,
      hiddenReason: (r.hidden_reason as string | null) ?? '',
    }));
  }

  /** Takes a course offline for its student (or puts it back). The content is kept. */
  setCourseHidden(userId: string, id: string, reason: string | null): boolean {
    return this.db.prepare('UPDATE courses SET hidden_reason = ?, updated_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL').run(reason, this.now(), userId, id).changes === 1;
  }

  /* ---------- owner dashboard: AI ---------- */

  private aiRows(where: string, args: Array<string | number>, limit: number): AiRequestRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.ts, r.user_id, u.email, r.kind, r.provider, r.model, r.prompt_tokens, r.output_tokens, r.tokens_estimated, r.duration_ms,
           r.status, r.error_code, r.error_message, r.cached, r.lesson_title, r.resolved_at
         FROM ai_requests r LEFT JOIN users u ON u.id = r.user_id WHERE ${where} ORDER BY r.id DESC LIMIT ?`,
      )
      .all(...args, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as number,
      userId: r.user_id as string | null,
      userEmail: (r.email as string | null) ?? null,
      kind: r.kind as string,
      provider: r.provider as string,
      model: r.model as string,
      promptTokens: r.prompt_tokens as number,
      outputTokens: r.output_tokens as number,
      tokensEstimated: r.tokens_estimated === 1,
      durationMs: r.duration_ms as number,
      status: (r.status === 'running' ? 'failed' : r.status) as AiRequestRow['status'],
      errorCode: r.error_code as string,
      errorMessage: r.error_message as string,
      cached: r.cached === 1,
      lessonTitle: r.lesson_title as string,
      resolvedAt: r.resolved_at as number | null,
    }));
  }

  aiReport(rangeDays: number, provider: { id: string; model: string }): AdminAi {
    const from = dayOf(this.now() - (rangeDays - 1) * DAY_MS);
    const all = <T>(sql: string, ...args: Array<string | number>) => this.db.prepare(sql).all(...args) as T[];
    // "Real" requests reached the provider: not served from the cache and not refused beforehand.
    const real = "cached = 0 AND status <> 'refused'";
    const t = this.db
      .prepare(
        `SELECT COALESCE(SUM(${real}), 0) AS requests, COALESCE(SUM(${real} AND status = 'ok'), 0) AS ok,
           COALESCE(SUM(${real} AND status IN ('failed', 'running')), 0) AS failed, COALESCE(SUM(status = 'refused'), 0) AS refused,
           COALESCE(SUM(cached = 1), 0) AS cached, COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(output_tokens), 0) AS o,
           COALESCE(AVG(CASE WHEN ${real} AND status = 'ok' THEN duration_ms END), 0) AS avg_ms,
           COALESCE(SUM(${real} AND tokens_estimated = 1), 0) AS est
         FROM ai_requests WHERE day >= ?`,
      )
      .get(from) as { requests: number; ok: number; failed: number; refused: number; cached: number; p: number; o: number; avg_ms: number; est: number };
    const totals: AiTotals = {
      requests: t.requests,
      ok: t.ok,
      failed: t.failed,
      refused: t.refused,
      cached: t.cached,
      promptTokens: t.p,
      outputTokens: t.o,
      avgMs: Math.round(t.avg_ms),
      estimatedTokenRequests: t.est,
      estCostUsd: this.estCost(t.p, t.o),
    };
    const dailyRows = all<{ day: string; requests: number; failed: number; p: number; o: number }>(
      `SELECT day, COUNT(*) AS requests, COALESCE(SUM(status <> 'ok'), 0) AS failed, SUM(prompt_tokens) AS p, SUM(output_tokens) AS o
       FROM ai_requests WHERE day >= ? AND ${real} GROUP BY day`,
      from,
    );
    const byDay = new Map(dailyRows.map((r) => [r.day, r]));
    return {
      rangeDays,
      totals,
      daily: this.dayList(rangeDays).map((day) => ({
        day,
        requests: byDay.get(day)?.requests ?? 0,
        failed: byDay.get(day)?.failed ?? 0,
        promptTokens: byDay.get(day)?.p ?? 0,
        outputTokens: byDay.get(day)?.o ?? 0,
      })),
      byModel: all(
        `SELECT provider, model, COUNT(*) AS requests, COALESCE(SUM(status <> 'ok'), 0) AS failed, SUM(prompt_tokens) AS promptTokens,
           SUM(output_tokens) AS outputTokens, CAST(COALESCE(AVG(CASE WHEN status = 'ok' THEN duration_ms END), 0) AS INTEGER) AS avgMs
         FROM ai_requests WHERE day >= ? AND ${real} GROUP BY provider, model ORDER BY requests DESC`,
        from,
      ),
      byKind: all(
        `SELECT kind, COUNT(*) AS requests, COALESCE(SUM(status <> 'ok'), 0) AS failed,
           CAST(COALESCE(AVG(CASE WHEN status = 'ok' THEN duration_ms END), 0) AS INTEGER) AS avgMs
         FROM ai_requests WHERE day >= ? AND ${real} GROUP BY kind ORDER BY requests DESC`,
        from,
      ),
      byUser: all(
        `SELECT r.user_id AS userId, u.email AS email, COUNT(*) AS requests, COALESCE(SUM(r.status <> 'ok'), 0) AS failed,
           SUM(r.prompt_tokens + r.output_tokens) AS tokens
         FROM ai_requests r LEFT JOIN users u ON u.id = r.user_id WHERE r.day >= ? AND r.cached = 0 AND r.status <> 'refused'
         GROUP BY r.user_id ORDER BY requests DESC LIMIT 25`,
        from,
      ),
      failures: this.aiRows("r.day >= ? AND r.status <> 'ok'", [from], 60),
      today: { requests: this.aiCountToday(), dailyLimit: this.settings().limits.dailyAiRequests },
      provider,
    };
  }

  /** Marks a failed request as looked at, so it leaves the owner's open list. */
  resolveAiFailure(id: number, resolved: boolean): boolean {
    return this.db.prepare("UPDATE ai_requests SET resolved_at = ? WHERE id = ? AND status <> 'ok'").run(resolved ? this.now() : null, id).changes === 1;
  }

  /* ---------- owner dashboard: invites and operations ---------- */

  listInvites(): InviteRow[] {
    return this.db
      .prepare('SELECT code, note, max_uses AS maxUses, uses, created_at AS createdAt, revoked_at AS revokedAt FROM invites ORDER BY created_at DESC LIMIT 300')
      .all() as unknown as InviteRow[];
  }

  revokeInvite(code: string): boolean {
    return this.db.prepare('UPDATE invites SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL').run(this.now(), code).changes === 1;
  }

  rowCounts(): Record<string, number> {
    const tables = ['users', 'courses', 'visits', 'events', 'ai_requests', 'audit'];
    return Object.fromEntries(tables.map((name) => [name, (this.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n]));
  }

  dbBytes(): number {
    if (this.dbPath === ':memory:') return 0;
    return [this.dbPath, `${this.dbPath}-wal`].reduce((n, file) => n + (existsSync(file) ? statSync(file).size : 0), 0);
  }

  backupInfo(): { file: string; at: number } | null {
    if (this.lastBackup || this.dbPath === ':memory:') return this.lastBackup;
    const dir = join(dirname(this.dbPath), 'backups');
    if (!existsSync(dir)) return null;
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ file: f, at: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0];
    return latest ? { file: latest.file, at: Math.round(latest.at) } : null;
  }

  /** Writes a consistent copy of the database next to it. Returns the file name only. */
  backup(): { file: string; at: number } {
    if (this.dbPath === ':memory:') throw new Error('An in-memory database cannot be backed up.');
    const dir = join(dirname(this.dbPath), 'backups');
    mkdirSync(dir, { recursive: true });
    const at = this.now();
    const file = `una-${new Date(at).toISOString().replace(/[:.]/g, '-')}.db`;
    this.db.prepare('VACUUM INTO ?').run(join(dir, file));
    // Each copy holds every account, so only the most recent ones are kept.
    const old = readdirSync(dir)
      .filter((f) => /^una-[0-9TZ-]+\.db$/.test(f))
      .sort()
      .slice(0, -BACKUPS_KEPT);
    for (const f of old) unlinkSync(join(dir, f));
    this.lastBackup = { file, at };
    return this.lastBackup;
  }
}
