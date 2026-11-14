import { describe, it } from 'node:test';
import type { Course, QuizQuestion, Section } from '../lib/learning/types.ts';
import {
  answerQuiz,
  applyGrade,
  applyGrades,
  conceptMastery,
  dayIndex,
  describeDue,
  dueItems,
  INTERVAL_DAYS,
  itemKey,
  MAX_BOX,
  nextDueDay,
  quizScore,
  startQuiz,
  summarizeMastery,
  type ReviewMap,
} from '../lib/progress/mastery.ts';
import { expect } from './helpers/expect.ts';

const demo = { kind: 'demo' } as const;
const TODAY = 20_000;

const question = (id: string, conceptId?: string): QuizQuestion => ({
  id,
  conceptId,
  level: 1,
  prompt: `Prompt ${id}`,
  choices: ['a', 'b', 'c', 'd'],
  answerIndex: 0,
  explanation: 'Because.',
  xp: 10,
  provenance: demo,
});

const section = (id: string, questions: QuizQuestion[], cards = 1): Section => ({
  id,
  title: `Lesson ${id}`,
  estMinutes: '5 min',
  difficulty: 'Beginner',
  xpReward: 20,
  objectives: [],
  keyPoints: [],
  notes: [],
  questions,
  flashcards: Array.from({ length: cards }, (_, i) => ({ id: `${id}-f${i + 1}`, front: 'term', back: 'meaning', provenance: demo })),
  provenance: demo,
});

const course = (id: string, sections: Section[], concepts: Array<{ id: string; name: string }> = []): Course => ({
  id,
  code: 'T',
  title: `Course ${id}`,
  unitLabel: 'Unit',
  unitTitle: 'Unit',
  pages: 3,
  accent: 'gold',
  sections,
  provenance: demo,
  ...(concepts.length
    ? {
        plan: {
          version: 1 as const,
          title: 'Plan',
          concepts: concepts.map((c) => ({
            ...c,
            summary: '',
            difficulty: 'Beginner' as const,
            importance: 'core' as const,
            pages: [1],
            prerequisites: [],
            evidence: [],
          })),
          lessons: [],
          flagged: [],
          pageChars: [],
        },
      }
    : {}),
});

describe('applyGrade', () => {
  it('schedules a new item answered correctly for tomorrow', () => {
    expect(applyGrade(undefined, 'good', TODAY)).toEqual({ box: 1, due: TODAY + 1, seen: 1, lapses: 0 });
  });

  it('skips a box when the student rates a card easy', () => {
    expect(applyGrade(undefined, 'easy', TODAY)).toEqual({ box: 2, due: TODAY + INTERVAL_DAYS[2], seen: 1, lapses: 0 });
  });

  it('keeps a missed item due today and counts the lapse', () => {
    const known = { box: 4, due: TODAY, seen: 6, lapses: 0 };
    expect(applyGrade(known, 'again', TODAY)).toEqual({ box: 0, due: TODAY, seen: 7, lapses: 1 });
  });

  it('spaces reviews further apart after each correct recall', () => {
    let record = applyGrade(undefined, 'good', TODAY);
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const day = record.due;
      record = applyGrade(record, 'good', day);
      gaps.push(record.due - day);
    }
    expect(gaps).toEqual([3, 7, 16, 35]);
  });

  it('does not promote an item that is practised again before it is due', () => {
    const first = applyGrade(undefined, 'good', TODAY);
    const replay = applyGrade(first, 'easy', TODAY);
    expect(replay).toEqual({ ...first, seen: 2 });
  });

  it('still records a miss on an item that was not due yet', () => {
    const first = applyGrade(undefined, 'easy', TODAY);
    expect(applyGrade(first, 'again', TODAY).box).toBe(0);
  });

  it('never goes past the last box', () => {
    const top = { box: MAX_BOX, due: TODAY, seen: 9, lapses: 0 };
    const next = applyGrade(top, 'easy', TODAY);
    expect(next.box).toBe(MAX_BOX);
    expect(next.due).toBe(TODAY + INTERVAL_DAYS[MAX_BOX]);
  });
});

describe('applyGrades', () => {
  it('updates only the graded items and leaves the original map untouched', () => {
    const before: ReviewMap = { keep: { box: 2, due: TODAY + 2, seen: 2, lapses: 0 } };
    const after = applyGrades(before, [{ key: 'new', grade: 'good' }], TODAY);
    expect(after.keep).toBe(before.keep);
    expect(after.new.box).toBe(1);
    expect(before.new).toBe(undefined);
  });

  it('returns the same map when there is nothing to grade', () => {
    const before: ReviewMap = {};
    expect(applyGrades(before, [], TODAY)).toBe(before);
  });
});

describe('dueItems', () => {
  const c = course('c1', [section('s1', [question('q1'), question('q2')]), section('s2', [question('q3')])]);
  const key = (s: string, i: string) => itemKey('c1', s, i);

  it('returns only practised items whose day has come', () => {
    const review: ReviewMap = {
      [key('s1', 'q1')]: { box: 1, due: TODAY, seen: 1, lapses: 0 },
      [key('s1', 'q2')]: { box: 1, due: TODAY + 1, seen: 1, lapses: 0 },
      [key('s1', 's1-f1')]: { box: 2, due: TODAY - 3, seen: 2, lapses: 0 },
    };
    const due = dueItems([c], review, TODAY);
    expect(due.map((d) => `${d.kind}:${d.key}`)).toEqual([`question:${key('s1', 'q1')}`, `flashcard:${key('s1', 's1-f1')}`]);
  });

  it('puts missed items first, then the most overdue', () => {
    const review: ReviewMap = {
      [key('s1', 'q1')]: { box: 3, due: TODAY - 9, seen: 4, lapses: 0 },
      [key('s1', 'q2')]: { box: 0, due: TODAY, seen: 2, lapses: 1 },
      [key('s2', 'q3')]: { box: 3, due: TODAY - 1, seen: 4, lapses: 0 },
    };
    expect(dueItems([c], review, TODAY).map((d) => d.key)).toEqual([key('s1', 'q2'), key('s1', 'q1'), key('s2', 'q3')]);
  });

  it('ignores records for a course that was removed', () => {
    const review: ReviewMap = { 'gone/s1/q1': { box: 0, due: TODAY, seen: 1, lapses: 1 } };
    expect(dueItems([c], review, TODAY)).toEqual([]);
  });

  it('respects the session limit', () => {
    const review: ReviewMap = {
      [key('s1', 'q1')]: { box: 1, due: TODAY, seen: 1, lapses: 0 },
      [key('s1', 'q2')]: { box: 1, due: TODAY, seen: 1, lapses: 0 },
      [key('s2', 'q3')]: { box: 1, due: TODAY, seen: 1, lapses: 0 },
    };
    expect(dueItems([c], review, TODAY, 2).length).toBe(2);
  });

  it('reports the next due day, or null before any practice', () => {
    expect(nextDueDay([c], {})).toBe(null);
    const review: ReviewMap = {
      [key('s1', 'q1')]: { box: 2, due: TODAY + 3, seen: 2, lapses: 0 },
      [key('s2', 'q3')]: { box: 1, due: TODAY + 1, seen: 1, lapses: 0 },
      'gone/s/q': { box: 0, due: TODAY - 5, seen: 1, lapses: 1 },
    };
    expect(nextDueDay([c], review)).toBe(TODAY + 1);
  });
});

describe('conceptMastery', () => {
  const c = course(
    'c1',
    [section('s1', [question('q1', 'k1'), question('q2', 'k1'), question('q3', 'k2')]), section('s2', [question('q4')])],
    [
      { id: 'k1', name: 'Osmosis' },
      { id: 'k2', name: 'Diffusion' },
    ],
  );
  const key = (s: string, i: string) => itemKey('c1', s, i);

  it('groups questions by planned concept and falls back to the lesson', () => {
    const m = conceptMastery(c, {});
    expect(m.map((x) => [x.id, x.name, x.questions, x.level])).toEqual([
      ['k1', 'Osmosis', 2, 'new'],
      ['k2', 'Diffusion', 1, 'new'],
      ['s2', 'Lesson s2', 1, 'new'],
    ]);
  });

  it('marks a concept weak while any of its questions is still missed', () => {
    const review: ReviewMap = {
      [key('s1', 'q1')]: { box: 5, due: TODAY + 30, seen: 6, lapses: 0 },
      [key('s1', 'q2')]: { box: 0, due: TODAY, seen: 2, lapses: 1 },
    };
    expect(conceptMastery(c, review)[0].level).toBe('weak');
  });

  it('marks a concept strong only when every practised question is in a late box', () => {
    const strong: ReviewMap = {
      [key('s1', 'q1')]: { box: 4, due: TODAY + 9, seen: 4, lapses: 0 },
      [key('s1', 'q2')]: { box: 5, due: TODAY + 30, seen: 5, lapses: 1 },
    };
    const k1 = conceptMastery(c, strong)[0];
    expect(k1.level).toBe('strong');
    expect(k1.score).toBe(1);
    const learning: ReviewMap = { ...strong, [key('s1', 'q2')]: { box: 2, due: TODAY + 2, seen: 2, lapses: 0 } };
    const again = conceptMastery(c, learning)[0];
    expect(again.level).toBe('learning');
    expect(again.score).toBe(0.75);
  });

  it('summarizes weak, learning and strong concepts across courses', () => {
    const review: ReviewMap = {
      [key('s1', 'q1')]: { box: 0, due: TODAY, seen: 1, lapses: 1 },
      [key('s1', 'q3')]: { box: 1, due: TODAY + 1, seen: 1, lapses: 0 },
      [key('s2', 'q4')]: { box: 4, due: TODAY + 16, seen: 4, lapses: 0 },
    };
    const summary = summarizeMastery([c], review);
    expect(summary.weak.map((w) => w.name)).toEqual(['Osmosis']);
    expect([summary.learning, summary.strong, summary.practised]).toEqual([1, 1, 3]);
  });
});

describe('quiz run', () => {
  it('asks every question once when all answers are right', () => {
    let run = startQuiz(3);
    for (let i = 0; i < 3; i++) run = answerQuiz(run, true);
    expect(run.queue).toEqual([]);
    expect(quizScore(run)).toBe(3);
    expect(run.misses).toBe(0);
  });

  it('brings a missed question back at the end until it is answered correctly', () => {
    let run = startQuiz(3);
    run = answerQuiz(run, false); // q0 wrong
    expect(run.queue).toEqual([1, 2, 0]);
    run = answerQuiz(run, true);
    run = answerQuiz(run, true);
    run = answerQuiz(run, false); // q0 wrong again
    expect(run.queue).toEqual([0]);
    run = answerQuiz(run, true);
    expect(run.queue).toEqual([]);
    expect(run.misses).toBe(2);
  });

  it('scores the first attempt only', () => {
    let run = startQuiz(2);
    run = answerQuiz(run, false);
    run = answerQuiz(run, true);
    run = answerQuiz(run, true);
    expect(run.firstTry).toEqual([false, true]);
    expect(quizScore(run)).toBe(1);
  });

  it('does nothing once the queue is empty', () => {
    const done = answerQuiz(startQuiz(1), true);
    expect(answerQuiz(done, false)).toBe(done);
  });
});

describe('days', () => {
  it('describes when an item is due', () => {
    expect(describeDue(TODAY - 2, TODAY)).toBe('today');
    expect(describeDue(TODAY + 1, TODAY)).toBe('tomorrow');
    expect(describeDue(TODAY + 7, TODAY)).toBe('in 7 days');
  });

  it('changes day at local midnight, not UTC midnight', () => {
    const lateEvening = new Date(2026, 10, 13, 23, 30);
    const afterMidnight = new Date(2026, 10, 14, 0, 30);
    expect(dayIndex(afterMidnight) - dayIndex(lateEvening)).toBe(1);
    expect(dayIndex(new Date(2026, 10, 13, 0, 5))).toBe(dayIndex(lateEvening));
  });
});
