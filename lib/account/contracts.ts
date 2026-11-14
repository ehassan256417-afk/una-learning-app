/**
 * Shapes shared by the frontend and the platform backend for accounts,
 * synced learning data, measured activity and the owner dashboard.
 *
 * Timestamps are milliseconds since 1970. Days are UTC dates, "YYYY-MM-DD".
 */

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'owner';
  beta: boolean;
  createdAt: number;
}

export interface AuthResponse {
  token: string;
  user: AccountUser;
}

export type RegistrationMode = 'open' | 'invite' | 'closed';

/** Everything the owner can change from the dashboard. Stored in the database, not in code. */
export interface PlatformSettings {
  registration: { mode: RegistrationMode };
  limits: {
    /** AI requests one student may make per UTC day. */
    userDailyAiRequests: number;
    /** AI requests across the whole platform per UTC day. */
    dailyAiRequests: number;
    /** AI requests and tokens for one course (plan plus lessons). */
    courseMaxRequests: number;
    courseMaxTokens: number;
    /** Courses one student may keep in their account. */
    maxCoursesPerUser: number;
  };
  features: {
    /** Creating lessons from an uploaded file. Enforced by the backend. */
    generation: boolean;
    /** Accepting PowerPoint files on the upload screen. */
    pptxUpload: boolean;
    spacedReview: boolean;
    /** Showing the built-in sample courses to students. */
    sampleCourses: boolean;
  };
  announcement: { active: boolean; text: string; tone: 'info' | 'warning' };
  ai: {
    /** Model name sent to the provider. Empty means the server's configured default. */
    model: string;
    /** US dollars per million tokens, used only for cost estimates. 0 means "not set". */
    inputPricePerMTok: number;
    outputPricePerMTok: number;
  };
  site: { tagline: string; supportEmail: string };
  learning: {
    /** Most items in one spaced-review session. */
    reviewSessionSize: number;
    /** XP a student aims for each day (shown on the dashboard). */
    dailyGoalXp: number;
  };
}

/** The part of the settings every visitor's browser may read. */
export interface PublicConfig {
  registration: RegistrationMode;
  features: PlatformSettings['features'];
  announcement: { text: string; tone: 'info' | 'warning' } | null;
  site: PlatformSettings['site'];
  learning: PlatformSettings['learning'];
}

export interface ProgressEnvelope {
  /** Increases with every saved change; 0 means nothing is saved yet. */
  rev: number;
  state: unknown | null;
}

export interface CourseIndexEntry {
  id: string;
  updatedAt: number;
}

export interface DayActivity {
  day: string;
  activeMin: number;
  studyMin: number;
}

export interface MyStats {
  days: DayActivity[];
  totalActiveMin: number;
  totalStudyMin: number;
  sessions: number;
  aiRequestsToday: number;
  aiDailyLimit: number;
  courses: number;
  courseLimit: number;
}

export const ACTIVITY_EVENT_TYPES = [
  'page_view',
  'upload_selected',
  'generation_started',
  'generation_finished',
  'lesson_started',
  'lesson_completed',
  'review_completed',
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/** One batch of measured activity from a browser. */
export interface ActivityBatch {
  visitorId: string;
  visitId: string;
  referrer?: string;
  /** Milliseconds of real interaction since the previous batch (tab visible and recent input). */
  activeMs: number;
  /** The part of `activeMs` spent in a lesson or a review session. */
  studyMs: number;
  events: Array<{ type: ActivityEventType; path?: string; prev?: string; value?: number }>;
}

/* ---------- owner dashboard ---------- */

export interface TrafficTotals {
  visits: number;
  /** Distinct browsers. An estimate: one person on two devices counts twice. */
  visitors: number;
  pageViews: number;
  signups: number;
  logins: number;
  /** Signed-in accounts with measured activity. */
  activeUsers: number;
  activeMin: number;
  studyMin: number;
  avgVisitMin: number;
}

export interface DailyPoint extends Omit<TrafficTotals, 'avgVisitMin'> {
  day: string;
}

export interface AdminOverview {
  rangeDays: number;
  generatedAt: number;
  totals: TrafficTotals;
  /** The same numbers for the period just before this one, for trends. */
  previous: TrafficTotals;
  allTime: { users: number; visitors: number; visits: number; courses: number; lessonsCompleted: number };
  live: { activeNow: number; activeUsersToday: number; activeUsers7d: number; activeUsers30d: number };
  daily: DailyPoint[];
  topPages: Array<{ path: string; views: number; visitors: number }>;
  transitions: Array<{ from: string; to: string; count: number }>;
  exits: Array<{ path: string; exits: number; visits: number }>;
  funnel: Array<{ step: string; label: string; count: number }>;
  retention: { newVisitors: number; returned: number };
  referrers: Array<{ referrer: string; visits: number }>;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'owner';
  status: 'active' | 'suspended';
  beta: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  lastSeenAt: number | null;
  loginCount: number;
  courses: number;
  activeMin: number;
  studyMin: number;
  aiRequests: number;
  note: string;
}

export interface AdminCourseRow {
  userId: string;
  userEmail: string;
  id: string;
  title: string;
  documentName: string;
  sourceKind: string;
  lessonsReady: number;
  lessonsPlanned: number;
  lessonsFailed: number;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  hidden: boolean;
  hiddenReason: string;
}

export interface AiRequestRow {
  id: number;
  ts: number;
  userId: string | null;
  userEmail: string | null;
  kind: string;
  provider: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
  tokensEstimated: boolean;
  durationMs: number;
  status: 'ok' | 'failed' | 'refused';
  errorCode: string;
  errorMessage: string;
  cached: boolean;
  lessonTitle: string;
  resolvedAt: number | null;
}

export interface AdminUserDetail extends AdminUserRow {
  inviteCode: string | null;
  signedInDevices: number;
  visits: number;
  avgVisitMin: number;
  learning: {
    xp: number;
    streak: number;
    lastStudyDay: string | null;
    lessonsStarted: number;
    lessonsCompleted: number;
    quizCorrect: number;
    quizTotal: number;
    reviewSessions: number;
    itemsTracked: number;
    weak: number;
    learning: number;
    strong: number;
  };
  ai: {
    requests: number;
    ok: number;
    failed: number;
    cached: number;
    promptTokens: number;
    outputTokens: number;
    /** Null when no prices are set. Always an estimate. */
    estCostUsd: number | null;
    today: number;
    dailyLimit: number;
  };
  courseList: AdminCourseRow[];
  daily: DayActivity[];
  recentAi: AiRequestRow[];
}

export interface AiTotals {
  requests: number;
  ok: number;
  failed: number;
  refused: number;
  cached: number;
  promptTokens: number;
  outputTokens: number;
  avgMs: number;
  /** Requests whose token counts the provider did not report, so they were estimated. */
  estimatedTokenRequests: number;
  estCostUsd: number | null;
}

export interface AdminAi {
  rangeDays: number;
  totals: AiTotals;
  daily: Array<{ day: string; requests: number; failed: number; promptTokens: number; outputTokens: number }>;
  byModel: Array<{ provider: string; model: string; requests: number; failed: number; promptTokens: number; outputTokens: number; avgMs: number }>;
  byKind: Array<{ kind: string; requests: number; failed: number; avgMs: number }>;
  byUser: Array<{ userId: string | null; email: string | null; requests: number; failed: number; tokens: number }>;
  failures: AiRequestRow[];
  today: { requests: number; dailyLimit: number };
  provider: { id: string; model: string };
}

export interface AuditRow {
  id: number;
  ts: number;
  actorEmail: string;
  action: string;
  target: string;
  detail: string;
}

export interface InviteRow {
  code: string;
  note: string;
  maxUses: number;
  uses: number;
  createdAt: number;
  revokedAt: number | null;
}

export interface AdminOps {
  startedAt: number;
  uptimeSec: number;
  node: string;
  dbBytes: number;
  rows: Record<string, number>;
  provider: { id: string; model: string };
  /** HTTP responses since the server started. */
  http: { total: number; clientErrors: number; serverErrors: number };
  lastBackup: { file: string; at: number } | null;
}

export type PlatformErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'email_taken'
  | 'invalid_credentials'
  | 'suspended'
  | 'registration_closed'
  | 'invite_required'
  | 'invalid_invite'
  | 'invalid_reset'
  | 'conflict'
  | 'limit_reached'
  | 'feature_disabled';
