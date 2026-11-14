import type { ExtractedDocument, LessonGenerateRequest, LessonGenerateResponse, PlanResponse } from './contracts.ts';
import { computeCoverage } from './coverage.ts';
import type { BudgetUse, Course, GroundingReport, LessonPlan, LessonState, Section, SourceKind } from './types.ts';

/**
 * Drives adaptive generation from the browser: one planning request, then one
 * request per planned lesson. The course is saved after every lesson, so a
 * failure part-way never discards what was already generated.
 *
 * Nothing is retried automatically. A failed lesson stays marked as failed
 * until the student asks for the remaining lessons, because every retry is a
 * new AI request that costs credits.
 *
 * This module has no React or browser dependencies so it can be tested in Node.
 */

export interface AdaptiveApi {
  plan(doc: ExtractedDocument, signal?: AbortSignal): Promise<PlanResponse>;
  lesson(body: LessonGenerateRequest, signal?: AbortSignal): Promise<LessonGenerateResponse>;
}

export type AdaptiveProgress =
  | { stage: 'planning' }
  | { stage: 'lesson'; index: number; total: number; title: string; course: Course };

export interface AdaptiveResult {
  course: Course;
  ready: number;
  failed: number;
  pending: number;
  /** Set when generation stopped before trying every lesson. */
  stopped?: { code: string; message: string };
}

export interface AdaptiveOptions {
  doc: ExtractedDocument;
  api: AdaptiveApi;
  /**
   * A saved course for this document with lessons still missing. Its plan is
   * reused (no new planning request) and only missing lessons are requested.
   */
  resume?: Course;
  /** Persists the course. Returns false when storage refused it. */
  save: (course: Course) => boolean;
  /**
   * Set when an older course for this document is already saved and is being
   * regenerated: nothing is saved until the first new lesson exists, so a
   * failure right after planning cannot replace finished lessons with an empty course.
   */
  deferFirstSave?: boolean;
  onProgress?: (progress: AdaptiveProgress) => void;
  signal?: AbortSignal;
  now?: () => string;
}

/** Errors after which further requests would fail the same way, so the loop stops instead of spending more. */
const STOP_CODES = new Set([
  'budget_exhausted',
  'rate_limited',
  'provider_rate_limited',
  'provider_not_configured',
  'forbidden_origin',
  'network',
  'not_connected',
]);
/** Two lessons failing in a row also stops the loop, whatever the reason. */
const MAX_CONSECUTIVE_FAILURES = 2;

const describe = (err: unknown): { code: string; message: string } => {
  const e = err as { code?: unknown; message?: unknown };
  return {
    code: typeof e?.code === 'string' ? e.code : 'unknown',
    message: typeof e?.message === 'string' && e.message ? e.message : 'Something went wrong while creating this lesson.',
  };
};

const addReports = (a: GroundingReport, b: GroundingReport): GroundingReport => ({
  checked: a.checked + b.checked,
  kept: a.kept + b.kept,
  dropped: a.dropped + b.dropped,
  reasons: [...a.reasons, ...b.reasons].slice(0, 8),
});

const EMPTY_REPORT: GroundingReport = { checked: 0, kept: 0, dropped: 0, reasons: [] };

export interface CourseMeta {
  documentId: string;
  documentName: string;
  pageCount: number;
  provider: string;
  model: string;
  createdAt: string;
  /** Set when the document is a presentation, so citations read "slide" instead of "page". */
  sourceKind?: SourceKind;
}

/** Builds the saved course from the plan and whatever lessons exist so far, in plan order. */
export function assembleCourse(
  meta: CourseMeta,
  plan: LessonPlan,
  sections: Section[],
  states: LessonState[],
  report: GroundingReport,
  budget?: BudgetUse,
): Course {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const ordered = plan.lessons.map((l) => byId.get(l.id)).filter((s): s is Section => !!s);
  const slides = meta.sourceKind === 'pptx';
  const baseName =
    meta.documentName.replace(/\.(pdf|pptx)$/i, '').slice(0, 60) || (slides ? 'Uploaded slides' : 'Uploaded PDF');
  return {
    id: `pdf-${meta.documentId.slice(0, 12)}`,
    code: slides ? 'Slides' : 'PDF',
    title: plan.title || baseName,
    unitLabel: slides ? 'Your slides' : 'Your PDF',
    unitTitle: baseName,
    pages: meta.pageCount,
    accent: 'gold',
    sections: ordered,
    provenance: { kind: 'pdf', documentId: meta.documentId, citations: [] },
    generation: {
      provider: meta.provider,
      model: meta.model,
      createdAt: meta.createdAt,
      documentName: meta.documentName,
      report,
    },
    plan,
    lessonStates: states,
    coverage: computeCoverage(plan, ordered, states),
    ...(slides ? { sourceKind: 'pptx' as const } : {}),
    ...(budget ? { budget } : {}),
  };
}

/** Lessons of a saved adaptive course that still need generating (never generated, or failed). */
export function unfinishedLessons(course: Course): number {
  if (!course.plan) return 0;
  const ready = new Set(course.sections.map((s) => s.id));
  return course.plan.lessons.filter((l) => !ready.has(l.id)).length;
}

export async function generateAdaptiveCourse(options: AdaptiveOptions): Promise<AdaptiveResult> {
  const { doc, api, save, onProgress, signal } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const resume =
    options.resume?.plan && options.resume.provenance.kind === 'pdf' && options.resume.provenance.documentId === doc.id
      ? options.resume
      : undefined;

  let plan: LessonPlan;
  let meta: CourseMeta;
  let budget: BudgetUse | undefined;
  let report = EMPTY_REPORT;
  const sections = new Map<string, Section>();

  if (resume?.plan) {
    plan = resume.plan;
    meta = {
      documentId: doc.id,
      documentName: resume.generation?.documentName ?? doc.name,
      pageCount: resume.pages,
      provider: resume.generation?.provider ?? 'unknown',
      model: resume.generation?.model ?? 'unknown',
      createdAt: resume.generation?.createdAt ?? now(),
      sourceKind: resume.sourceKind ?? doc.sourceKind,
    };
    budget = resume.budget;
    report = resume.generation?.report ?? EMPTY_REPORT;
    for (const s of resume.sections) sections.set(s.id, s);
  } else {
    onProgress?.({ stage: 'planning' });
    // A planning failure leaves nothing to save; it is reported to the caller as is.
    const planned = await api.plan(doc, signal);
    plan = planned.plan;
    budget = planned.budget;
    meta = {
      documentId: planned.documentId,
      documentName: doc.name,
      pageCount: doc.pageCount,
      provider: planned.provider,
      model: planned.model,
      createdAt: now(),
      sourceKind: doc.sourceKind,
    };
  }

  // On resume, a lesson that failed before keeps its reason until it is tried again.
  const earlier = new Map((resume?.lessonStates ?? []).map((s) => [s.lessonId, s]));
  const states = new Map<string, LessonState>(
    plan.lessons.map((l): [string, LessonState] => {
      if (sections.has(l.id)) return [l.id, { lessonId: l.id, status: 'ready' }];
      const before = earlier.get(l.id);
      return [l.id, before?.status === 'failed' ? before : { lessonId: l.id, status: 'pending' }];
    }),
  );
  const build = () => assembleCourse(meta, plan, [...sections.values()], [...states.values()], report, budget);

  let course = build();
  let stopped: AdaptiveResult['stopped'];
  const holdSave = () => !!options.deferFirstSave && !resume && sections.size === 0;
  if (!holdSave() && !save(course)) {
    stopped = { code: 'storage', message: 'This browser has no space to save the course. Remove an older PDF course and try again.' };
  }

  const conceptName = new Map(plan.concepts.map((c) => [c.id, c.name]));
  let consecutiveFailures = 0;
  for (let i = 0; i < plan.lessons.length && !stopped; i++) {
    const lesson = plan.lessons[i];
    if (sections.has(lesson.id)) continue;
    if (signal?.aborted) {
      stopped = { code: 'aborted', message: 'Generation was stopped. The lessons already created are kept.' };
      break;
    }
    onProgress?.({ stage: 'lesson', index: i, total: plan.lessons.length, title: lesson.title, course });

    const taught = plan.lessons
      .slice(0, i)
      .filter((l) => sections.has(l.id))
      .flatMap((l) => l.conceptIds.map((id) => conceptName.get(id)))
      .filter((n): n is string => !!n);
    try {
      const result = await api.lesson(
        {
          documentId: meta.documentId,
          documentName: meta.documentName,
          lesson,
          concepts: plan.concepts.filter((c) => lesson.conceptIds.includes(c.id)),
          pages: doc.pages.filter((p) => lesson.pages.includes(p.page)),
          taught,
        },
        signal,
      );
      sections.set(lesson.id, result.section);
      states.set(lesson.id, { lessonId: lesson.id, status: 'ready' });
      report = addReports(report, result.report);
      budget = result.budget;
      consecutiveFailures = 0;
    } catch (err) {
      const problem = describe(err);
      if (signal?.aborted) {
        stopped = { code: 'aborted', message: 'Generation was stopped. The lessons already created are kept.' };
      } else {
        states.set(lesson.id, { lessonId: lesson.id, status: 'failed', reason: problem.message });
        consecutiveFailures++;
        if (STOP_CODES.has(problem.code)) stopped = problem;
        else if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopped = {
            code: 'repeated_failures',
            message: `Two lessons in a row could not be generated, so generation stopped to avoid spending more. Last problem: ${problem.message}`,
          };
        }
      }
    }
    course = build();
    if (!holdSave() && !save(course) && !stopped) {
      stopped = { code: 'storage', message: 'This browser has no space to save more lessons. Remove an older PDF course and try again.' };
    }
  }

  const all = [...states.values()];
  // With a deferred save, the earlier course is still what is stored if no new lesson was generated.
  if (holdSave() && !stopped) {
    stopped = { code: 'nothing_generated', message: 'No lesson could be generated, so your earlier lessons were kept.' };
  }
  return {
    course,
    ready: all.filter((s) => s.status === 'ready').length,
    failed: all.filter((s) => s.status === 'failed').length,
    pending: all.filter((s) => s.status === 'pending').length,
    ...(stopped ? { stopped } : {}),
  };
}
