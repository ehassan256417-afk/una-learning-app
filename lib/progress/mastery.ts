import type { Course, Flashcard, QuizQuestion, Section } from '../learning/types.ts';

/**
 * Mastery tracking and spaced review.
 *
 * Every quiz question and flashcard a student has practised gets a small
 * record: which "box" it is in and the day it is next due. A correct recall
 * moves the item up a box and pushes the next review further away; a miss sends
 * it back to the start. This is the Leitner system: simple enough to explain to
 * a student, and it spends review time on what they keep getting wrong.
 *
 * Pure functions only (no React, no storage) so the rules can be tested in Node.
 */

export type Grade = 'again' | 'good' | 'easy';

export interface ReviewRecord {
  /** 0 = missed last time; higher boxes are reviewed less often. */
  box: number;
  /** Day index (see `dayIndex`) on which the item is next due. */
  due: number;
  /** Times the item has been practised. */
  seen: number;
  /** Times it was missed. */
  lapses: number;
}

export type ReviewMap = Record<string, ReviewRecord>;

/** Days until the next review, by box. Box 0 is due again the same day. */
export const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35, 75] as const;
export const MAX_BOX = INTERVAL_DAYS.length - 1;
/** An item in this box or higher counts as well known. */
const STRONG_BOX = 4;

/** Whole days since 1970 in the student's own time zone, so "tomorrow" starts at their midnight. */
export const dayIndex = (date: Date): number =>
  Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000);

export const itemKey = (courseId: string, sectionId: string, itemId: string) => `${courseId}/${sectionId}/${itemId}`;

/**
 * The record after one practice attempt.
 *
 * Practising an item before it is due cannot move it up: otherwise replaying a
 * lesson five times in one evening would mark everything as mastered. A miss
 * always counts, whenever it happens.
 */
export function applyGrade(record: ReviewRecord | undefined, grade: Grade, today: number): ReviewRecord {
  const seen = (record?.seen ?? 0) + 1;
  const lapses = record?.lapses ?? 0;
  if (grade === 'again') return { box: 0, due: today, seen, lapses: lapses + 1 };
  if (record && record.due > today) return { ...record, seen };
  const box = Math.min(MAX_BOX, (record?.box ?? 0) + (grade === 'easy' ? 2 : 1));
  return { box, due: today + INTERVAL_DAYS[box], seen, lapses };
}

export interface GradeEntry {
  key: string;
  grade: Grade;
}

export function applyGrades(review: ReviewMap, grades: GradeEntry[], today: number): ReviewMap {
  if (grades.length === 0) return review;
  const next = { ...review };
  for (const g of grades) next[g.key] = applyGrade(next[g.key], g.grade, today);
  return next;
}

export type ReviewItem = {
  key: string;
  record: ReviewRecord;
  course: Course;
  section: Section;
} & ({ kind: 'question'; question: QuizQuestion } | { kind: 'flashcard'; card: Flashcard });

/**
 * Practised items that are due, most urgent first: missed items, then the most
 * overdue. Records whose course or lesson no longer exists are skipped.
 */
export function dueItems(courses: Course[], review: ReviewMap, today: number, limit = Infinity): ReviewItem[] {
  const due: ReviewItem[] = [];
  for (const course of courses) {
    for (const section of course.sections) {
      for (const question of section.questions) {
        const key = itemKey(course.id, section.id, question.id);
        const record = review[key];
        if (record && record.due <= today) due.push({ key, record, course, section, kind: 'question', question });
      }
      for (const card of section.flashcards) {
        const key = itemKey(course.id, section.id, card.id);
        const record = review[key];
        if (record && record.due <= today) due.push({ key, record, course, section, kind: 'flashcard', card });
      }
    }
  }
  due.sort((a, b) => a.record.box - b.record.box || a.record.due - b.record.due);
  return due.slice(0, limit);
}

/** The next day anything becomes due, or null when nothing has been practised. */
export function nextDueDay(courses: Course[], review: ReviewMap): number | null {
  let next: number | null = null;
  for (const course of courses) {
    for (const section of course.sections) {
      for (const item of [...section.questions, ...section.flashcards]) {
        const record = review[itemKey(course.id, section.id, item.id)];
        if (record && (next === null || record.due < next)) next = record.due;
      }
    }
  }
  return next;
}

export type MasteryLevel = 'new' | 'weak' | 'learning' | 'strong';

export interface ConceptMastery {
  /** Concept id from the lesson plan, or the lesson id when questions carry no concept. */
  id: string;
  name: string;
  courseId: string;
  sectionId: string;
  level: MasteryLevel;
  /** 0 to 1 across the concept's practised questions. */
  score: number;
  practised: number;
  questions: number;
}

/**
 * How well each concept is known, from the questions that practise it.
 * weak: something was missed and not yet recovered. strong: every practised
 * question has been recalled across several spaced reviews.
 */
export function conceptMastery(course: Course, review: ReviewMap): ConceptMastery[] {
  const names = new Map((course.plan?.concepts ?? []).map((c) => [c.id, c.name]));
  const result: ConceptMastery[] = [];
  for (const section of course.sections) {
    const groups = new Map<string, QuizQuestion[]>();
    for (const q of section.questions) {
      const id = q.conceptId && names.has(q.conceptId) ? q.conceptId : section.id;
      groups.set(id, [...(groups.get(id) ?? []), q]);
    }
    for (const [id, questions] of groups) {
      const records = questions
        .map((q) => review[itemKey(course.id, section.id, q.id)])
        .filter((r): r is ReviewRecord => !!r);
      const score = records.length
        ? records.reduce((sum, r) => sum + Math.min(r.box, STRONG_BOX) / STRONG_BOX, 0) / records.length
        : 0;
      const level: MasteryLevel =
        records.length === 0
          ? 'new'
          : records.some((r) => r.box === 0)
            ? 'weak'
            : records.every((r) => r.box >= STRONG_BOX)
              ? 'strong'
              : 'learning';
      result.push({
        id,
        name: names.get(id) ?? section.title,
        courseId: course.id,
        sectionId: section.id,
        level,
        score,
        practised: records.length,
        questions: questions.length,
      });
    }
  }
  return result;
}

export interface MasterySummary {
  weak: ConceptMastery[];
  learning: number;
  strong: number;
  practised: number;
}

export function summarizeMastery(courses: Course[], review: ReviewMap): MasterySummary {
  const all = courses.flatMap((c) => conceptMastery(c, review)).filter((m) => m.level !== 'new');
  return {
    weak: all.filter((m) => m.level === 'weak'),
    learning: all.filter((m) => m.level === 'learning').length,
    strong: all.filter((m) => m.level === 'strong').length,
    practised: all.length,
  };
}

/** "today", "tomorrow" or "in N days", for telling a student when an item comes back. */
export function describeDue(due: number, today: number): string {
  const days = due - today;
  if (days <= 0) return 'today';
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/**
 * The order questions are asked in one lesson: each question once, and a
 * missed question comes back at the end until it is answered correctly.
 * The lesson is finished only when the queue is empty, so a student cannot
 * move on with a mistake left uncorrected.
 */
export interface QuizRun {
  /** Question indexes still to ask, in order. The first is the current one. */
  queue: number[];
  /** Per question: whether the first attempt was right. null = not attempted yet. */
  firstTry: Array<boolean | null>;
  /** Wrong attempts so far, across all questions. */
  misses: number;
}

export const startQuiz = (count: number): QuizRun => ({
  queue: Array.from({ length: count }, (_, i) => i),
  firstTry: Array.from({ length: count }, () => null),
  misses: 0,
});

/** The run after the current question was answered. A miss re-queues it at the end. */
export function answerQuiz(run: QuizRun, correct: boolean): QuizRun {
  const [current, ...rest] = run.queue;
  if (current === undefined) return run;
  const firstTry = run.firstTry.map((v, i) => (i === current && v === null ? correct : v));
  return { queue: correct ? rest : [...rest, current], firstTry, misses: run.misses + (correct ? 0 : 1) };
}

export const quizScore = (run: QuizRun) => run.firstTry.filter((v) => v === true).length;
