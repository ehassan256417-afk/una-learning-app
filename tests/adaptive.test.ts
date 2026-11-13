import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { generateAdaptiveCourse, unfinishedLessons, type AdaptiveApi } from '../lib/learning/adaptive.ts';
import type {
  ApiErrorBody,
  ExtractedDocument,
  LessonGenerateRequest,
  LessonGenerateResponse,
  PlanResponse,
} from '../lib/learning/contracts.ts';
import { computeCoverage, summarizeCoverage } from '../lib/learning/coverage.ts';
import type { Course, LessonPlan } from '../lib/learning/types.ts';
import { documentIdFor } from '../lib/pdf/extract.ts';
import { courseProgress, sectionKey, sectionStatuses } from '../lib/progress/status.ts';
import { createApp, type AppOptions } from '../server/app.ts';
import { BudgetError, CourseBudgets } from '../server/budget.ts';
import { createLesson } from '../server/lesson.ts';
import { createPlan, normalizePlan } from '../server/plan.ts';
import { MockProvider } from '../server/providers/mock.ts';
import type { AiProvider, LessonRequest } from '../server/providers/types.ts';
import { parsePlanJson } from '../server/schema.ts';
import { extractSample, SAMPLES } from './helpers/samples.ts';

/**
 * A synthetic 7-page handout written for these tests (not real course material).
 * Pages 1-5 carry ten concepts, one of them explained across two pages.
 * Page 6 has text no concept uses, and page 7 has no text at all.
 */
const JOINS = [
  'A join combines rows from two tables by matching values in related columns. The join condition is the rule that decides which rows match. A primary key is a column whose value identifies each row of a table uniquely. A foreign key is a column that stores the primary key of a row in another table.',
  'An inner join returns only the rows that have a match in both tables. Rows without a match in the other table are left out of an inner join result. The keyword ON introduces the join condition in the query.',
  'A left outer join returns every row from the left table even when the right table has no match. Columns from the right table are filled with NULL when no match exists. A right outer join does the same for the right table instead of the left table.',
  'A full outer join returns all rows from both tables and fills the missing side with NULL. A cross join pairs every row of one table with every row of the other table. The result of a cross join is called a Cartesian product and it grows very quickly.',
  'A self join joins a table to itself by using two different aliases for the same table. Choosing the wrong join type can silently drop rows or create duplicate rows. Comparing inner joins with outer joins shows which rows each type keeps and which rows it removes.',
  'This closing page lists the people who reviewed the handout and thanks them for their careful comments on earlier drafts. It also records the room and the week in which the printed copies were handed out to everybody.',
];
const S = (page: number, i: number) => JOINS[page - 1].split(/(?<=\.)\s+/)[i];
const joinsPages = JOINS.map((text, i) => ({ page: i + 1, text }));
const joinsSource = { name: 'sql-joins.pdf', pageCount: 7, pages: joinsPages };
const joinsDoc = async (): Promise<ExtractedDocument> => ({
  id: await documentIdFor(joinsPages),
  name: joinsSource.name,
  pageCount: 7,
  pages: joinsPages,
  charCount: JOINS.join('').length,
});

const cite = (page: number, quote: string) => [{ page, quote }];
const concept = (id: string, name: string, page: number, quote: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  summary: quote,
  difficulty: 'Beginner',
  importance: 'core',
  pages: [page],
  prerequisites: [] as string[],
  evidence: cite(page, quote),
  ...extra,
});

const JOIN_CONCEPTS = [
  concept('join', 'Join', 1, S(1, 0)),
  concept('cond', 'Join condition', 1, S(1, 1), {
    pages: [1, 2],
    prerequisites: ['join'],
    evidence: [...cite(1, S(1, 1)), ...cite(2, S(2, 2))],
  }),
  concept('pk', 'Primary key', 1, S(1, 2)),
  concept('fk', 'Foreign key', 1, S(1, 3), { prerequisites: ['pk'] }),
  concept('inner', 'Inner join', 2, S(2, 0), { difficulty: 'Intermediate', prerequisites: ['join', 'cond'] }),
  concept('left', 'Left outer join', 3, S(3, 0), { difficulty: 'Intermediate', prerequisites: ['inner'] }),
  concept('right', 'Right outer join', 3, S(3, 2), { difficulty: 'Intermediate', importance: 'supporting' }),
  concept('full', 'Full outer join', 4, S(4, 0), { difficulty: 'Advanced' }),
  concept('cross', 'Cross join', 4, S(4, 1), { difficulty: 'Advanced' }),
  concept('self', 'Self join', 5, S(5, 0), { difficulty: 'Advanced' }),
  // Not in the handout: the planner must not be allowed to add it.
  concept('hash', 'Hash join', 2, 'A hash join builds a hash table in memory to match rows quickly.'),
];

const FIVE_LESSONS = [
  { title: 'Join basics', difficulty: 'Beginner', conceptIds: ['join', 'cond', 'pk', 'fk'], objectives: ['Explain what a join combines.'] },
  { title: 'Inner joins', difficulty: 'Intermediate', conceptIds: ['inner'], objectives: [] },
  { title: 'Left and right outer joins', difficulty: 'Intermediate', conceptIds: ['left', 'right'], objectives: [] },
  { title: 'Full and cross joins', difficulty: 'Advanced', conceptIds: ['full', 'cross'], objectives: [] },
  { title: 'Self joins', difficulty: 'Advanced', conceptIds: ['self'], objectives: [] },
];

const rawPlan = (lessons: unknown[], concepts: unknown[] = JOIN_CONCEPTS) =>
  JSON.stringify({ title: 'SQL Joins', concepts, lessons });

const planFor = async (lessons: unknown[], maxLessons = 10, concepts: unknown[] = JOIN_CONCEPTS) =>
  normalizePlan(parsePlanJson(rawPlan(lessons, concepts)), joinsSource, await documentIdFor(joinsPages), maxLessons);

const idOf = (plan: LessonPlan, name: string) => plan.concepts.find((c) => c.name === name)!.id;
const lessonWith = (plan: LessonPlan, name: string) => plan.lessons.findIndex((l) => l.conceptIds.includes(idOf(plan, name)));

/** Records every request and answers the plan with fixed JSON; lessons come from `lesson` or the offline mock. */
function scripted(plan: string, lesson?: (request: LessonRequest) => string) {
  const mock = new MockProvider();
  const provider = {
    id: 'scripted',
    model: 'test',
    requests: [] as LessonRequest[],
    async generate(request: LessonRequest) {
      provider.requests.push(request);
      if (request.task?.kind === 'plan') return plan;
      return lesson ? lesson(request) : mock.generate(request);
    },
  };
  return provider;
}

describe('adaptive plan: lesson count follows the concepts', () => {
  it('makes one lesson for a PDF with few concepts, not one per page', async () => {
    const doc = await extractSample('biology');
    const bio = SAMPLES.biology.pages;
    const raw = parsePlanJson(
      JSON.stringify({
        title: 'Photosynthesis',
        concepts: [
          concept('a', 'Photosynthesis', 1, bio[0].split(/(?<=\.)\s+/)[0]),
          concept('b', 'Chloroplasts', 1, bio[0].split(/(?<=\.)\s+/)[1]),
        ],
        lessons: [{ title: 'What photosynthesis is', conceptIds: ['a', 'b'], objectives: [] }],
      }),
    );
    const plan = normalizePlan(raw, doc, doc.id, 10);
    expect(doc.pageCount).toBe(3);
    expect(plan.lessons).toHaveLength(1);
    expect(plan.lessons[0].conceptIds).toHaveLength(2);
    expect(plan.lessons[0].pages).toEqual([1]);
    // The two unused pages are reported, not silently ignored.
    const coverage = computeCoverage(plan, []);
    expect(coverage.pages.filter((p) => p.status === 'omitted').map((p) => p.page)).toEqual([2, 3]);
  });

  it('keeps the planner\'s grouping for a PDF with many concepts', async () => {
    const plan = await planFor(FIVE_LESSONS);
    expect(plan.concepts).toHaveLength(10);
    expect(plan.lessons).toHaveLength(5);
    expect(plan.lessons.map((l) => l.conceptIds.length)).toEqual([4, 1, 2, 2, 1]);
    // Every verified concept is in exactly one lesson.
    const used = plan.lessons.flatMap((l) => l.conceptIds);
    expect([...used].sort()).toEqual(plan.concepts.map((c) => c.id).sort());
    expect(new Set(used).size).toBe(used.length);
    // Five lessons for seven pages: lessons are not tied to pages.
    expect(plan.pageChars).toHaveLength(7);
  });

  it('splits a lesson that tries to teach too many concepts at once', async () => {
    const plan = await planFor([{ title: 'Everything', conceptIds: JOIN_CONCEPTS.map((c) => c.id), objectives: [] }]);
    expect(plan.lessons).toHaveLength(3);
    expect(plan.lessons.map((l) => l.conceptIds.length)).toEqual([4, 4, 2]);
    expect(plan.lessons[0].title).toContain('part 1 of 3');
  });

  it('gives lessons to concepts the planner forgot to place, grouped by difficulty', async () => {
    const plan = await planFor([]);
    expect(plan.lessons.map((l) => l.difficulty)).toEqual(['Beginner', 'Beginner', 'Intermediate', 'Advanced']);
    expect(plan.lessons.flatMap((l) => l.conceptIds)).toHaveLength(10);
  });

  it('never drops below the lesson limit silently: left-out concepts are flagged', async () => {
    const plan = await planFor(FIVE_LESSONS, 2);
    expect(plan.lessons.map((l) => l.title)).toEqual(['Join basics', 'Full and cross joins']);
    const leftOut = plan.flagged.filter((f) => f.reason.includes('limited to 2 lessons')).map((f) => f.name);
    expect(leftOut.sort()).toEqual(['Inner join', 'Left outer join', 'Right outer join', 'Self join']);
  });

  it('tracks a concept that spans several pages back to each page', async () => {
    const plan = await planFor(FIVE_LESSONS);
    const spanning = plan.concepts.find((c) => c.name === 'Join condition')!;
    expect(spanning.pages).toEqual([1, 2]);
    expect(spanning.evidence.map((e) => e.page)).toEqual([1, 2]);
    expect(plan.lessons[lessonWith(plan, 'Join condition')].pages).toEqual([1, 2]);
  });

  it('does not accept invented concepts or prerequisites', async () => {
    const plan = await planFor(FIVE_LESSONS);
    expect(plan.concepts.map((c) => c.name)).not.toContain('Hash join');
    expect(plan.flagged.map((f) => f.name)).toContain('Hash join');
    expect(plan.flagged.find((f) => f.name === 'Hash join')!.reason).toContain('could not be matched');

    const looped = await planFor(
      [],
      10,
      [
        concept('a', 'Primary key', 1, S(1, 2), { prerequisites: ['ghost', 'b', 'a'] }),
        concept('b', 'Foreign key', 1, S(1, 3), { prerequisites: ['a'] }),
      ],
    );
    const [a, b] = looped.concepts;
    // The unknown id and the self-reference are gone, and the loop is broken in one direction.
    expect(a.prerequisites).toEqual([b.id]);
    expect(b.prerequisites).toEqual([]);
  });

  it('orders lessons so prerequisites come first, whatever order the planner used', async () => {
    const plan = await planFor([...FIVE_LESSONS].reverse());
    expect(lessonWith(plan, 'Join')).toBeLessThan(lessonWith(plan, 'Inner join'));
    expect(lessonWith(plan, 'Inner join')).toBeLessThan(lessonWith(plan, 'Left outer join'));
    expect(plan.lessons[0].difficulty).toBe('Beginner');
  });

  it('is deterministic and refuses a plan with nothing that matches the PDF', async () => {
    expect(await planFor(FIVE_LESSONS)).toEqual(await planFor(FIVE_LESSONS));
    const invented = [concept('x', 'Hash join', 2, 'A hash join builds a hash table in memory to match rows quickly.')];
    await expect(planFor([], 10, invented)).rejects.toMatchObject({ code: 'nothing_grounded' });
  });

  it('asks the provider once, with a bounded output, and does not retry a bad answer', async () => {
    const good = scripted(rawPlan(FIVE_LESSONS));
    const { plan } = await createPlan(joinsSource, good, { maxLessons: 10, maxTokens: 8000 });
    expect(plan.lessons).toHaveLength(5);
    expect(good.requests).toHaveLength(1);
    expect(good.requests[0].maxTokens).toBe(8000);
    expect(good.requests[0].task).toMatchObject({ kind: 'plan', maxLessons: 10 });

    const bad = scripted('Sure, here is a plan!');
    await expect(createPlan(joinsSource, bad, { maxLessons: 10, maxTokens: 8000 })).rejects.toMatchObject({
      code: 'invalid_ai_output',
    });
    expect(bad.requests).toHaveLength(1);
  });
});

describe('adaptive lesson: one bounded, grounded lesson', () => {
  const setup = async () => {
    const documentId = await documentIdFor(joinsPages);
    const plan = await planFor(FIVE_LESSONS);
    const lesson = plan.lessons[0];
    const id = (name: string) => idOf(plan, name);
    const answer = {
      keyPoints: [{ text: 'A join matches rows from two tables.', citations: cite(1, S(1, 0)) }],
      notes: [
        { conceptId: id('Join'), aspect: 'what', title: 'What a join is', body: 'A join combines rows from two tables. It works by matching values in related columns.', keyTerm: 'join', citations: cite(1, S(1, 0)) },
        { conceptId: id('Join condition'), aspect: 'how', title: 'How rows are matched', body: 'The join condition is the rule that decides which rows match, and the keyword ON introduces it in the query.', example: 'The keyword ON introduces the join condition', citations: [...cite(1, S(1, 1)), ...cite(2, S(2, 2))] },
        // Invented: must be removed.
        { conceptId: id('Primary key'), aspect: 'why', title: 'Why keys matter', body: 'Primary keys make queries run ten times faster on large clustered servers.', citations: cite(1, 'Primary keys make queries run ten times faster on large clustered servers.') },
        // Real note, but its example is not in the PDF: the example must be removed.
        { conceptId: id('Primary key'), aspect: 'what', title: 'Primary key', body: S(1, 2), example: 'SELECT * FROM students;', citations: cite(1, S(1, 2)) },
        // Tagged with a concept that is not part of this lesson: the tag must be removed.
        { conceptId: 'zzz', title: 'Foreign key', body: S(1, 3), citations: cite(1, S(1, 3)) },
      ],
      questions: [
        { conceptId: id('Join'), level: 1, prompt: 'What does a join combine?', choices: ['Rows from two tables', 'Columns from one table', 'Two separate databases', 'Primary keys only'], answerIndex: 0, explanation: S(1, 0), citations: cite(1, S(1, 0)) },
        { conceptId: id('Join condition'), level: 2, prompt: 'Which rule decides which rows match in a join?', choices: ['The join condition', 'The primary key', 'The foreign key', 'The table alias'], answerIndex: 0, explanation: S(1, 1), citations: cite(1, S(1, 1)) },
        // Circular: the prompt already contains the answer.
        { conceptId: id('Primary key'), level: 1, prompt: 'A primary key identifies each row uniquely. What is a primary key?', choices: ['A primary key', 'A foreign key', 'A join condition', 'A table alias'], answerIndex: 0, explanation: S(1, 2), citations: cite(1, S(1, 2)) },
        { conceptId: id('Foreign key'), level: 3, prompt: 'What does a foreign key store?', choices: ['The name of the table', 'The primary key of a row in another table', 'A copy of every column', 'The join condition'], answerIndex: 1, explanation: S(1, 3), citations: cite(1, S(1, 3)) },
      ],
      flashcards: [{ front: 'Join', back: 'Combines rows from two tables by matching values in related columns.', citations: cite(1, S(1, 0)) }],
    };
    const provider = scripted(rawPlan(FIVE_LESSONS), () => JSON.stringify(answer));
    const input = {
      documentId,
      documentName: joinsSource.name,
      pages: joinsPages.filter((p) => lesson.pages.includes(p.page)),
      lesson,
      concepts: plan.concepts.filter((c) => lesson.conceptIds.includes(c.id)),
      taught: [],
    };
    return { plan, lesson, answer, provider, input, id };
  };

  it('keeps grounded items, removes invented ones, and carries the plan\'s title, level and concepts', async () => {
    const { lesson, provider, input, id } = await setup();
    const { section, report } = await createLesson(input, provider, { maxTokens: 6000 });

    expect(section.id).toBe(lesson.id);
    expect(section.title).toBe('Join basics');
    expect(section.difficulty).toBe('Beginner');
    expect(section.conceptIds).toEqual(lesson.conceptIds);
    expect(section.pages).toEqual([1, 2]);

    expect(section.notes.map((n) => n.title)).toEqual(['What a join is', 'How rows are matched', 'Primary key', 'Foreign key']);
    expect(section.notes.map((n) => n.aspect)).toEqual(['what', 'how', 'what', undefined]);
    expect(section.notes[0].conceptId).toBe(id('Join'));
    expect(section.notes[3].conceptId).toBeUndefined();
    // An example is shown only when it really is on a cited page.
    expect(section.notes[1].example).toBe('The keyword ON introduces the join condition');
    expect(section.notes[2].example).toBeUndefined();

    expect(report.dropped).toBe(2);
    expect(report.kept + report.dropped).toBe(report.checked);
    expect(report.reasons.join(' | ')).toContain('already contains its answer');
  });

  it('shuffles answers without changing which choice is correct', async () => {
    const { answer, provider, input } = await setup();
    const { section } = await createLesson(input, provider, { maxTokens: 6000 });
    expect(section.questions).toHaveLength(3);
    for (const q of section.questions) {
      const original = answer.questions.find((x) => x.prompt === q.prompt)!;
      expect(q.choices[q.answerIndex]).toBe(original.choices[original.answerIndex]);
      expect([...q.choices].sort()).toEqual([...original.choices].sort());
    }
    expect(new Set(section.questions.map((q) => q.answerIndex)).size).toBe(3);
    // Every kept item still carries an exact, page-numbered quote.
    for (const item of [...section.notes, ...section.questions, ...section.flashcards]) {
      expect(item.provenance.kind).toBe('pdf');
      if (item.provenance.kind === 'pdf') expect(item.provenance.citations.length).toBeGreaterThan(0);
    }
  });

  it('sends only the lesson\'s own pages, with a bounded output, and never retries', async () => {
    const { provider, input } = await setup();
    await createLesson(input, provider, { maxTokens: 6000 });
    expect(provider.requests).toHaveLength(1);
    const sent = provider.requests[0];
    expect(sent.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(sent.maxTokens).toBe(6000);
    expect(sent.prompt).toContain(S(2, 0));
    expect(sent.prompt).not.toContain(S(5, 0));

    const bad = scripted('', () => 'not json at all');
    await expect(createLesson(input, bad, { maxTokens: 6000 })).rejects.toMatchObject({ code: 'invalid_ai_output' });
    expect(bad.requests).toHaveLength(1);

    const empty = scripted('', () => JSON.stringify({ notes: [], questions: [] }));
    await expect(createLesson(input, empty, { maxTokens: 6000 })).rejects.toMatchObject({ code: 'nothing_grounded' });
  });
});

describe('coverage report', () => {
  it('reports covered, partly covered and not-yet-generated concepts, and unused pages', async () => {
    const plan = await planFor(FIVE_LESSONS);
    const lesson = plan.lessons[0];
    const id = (name: string) => idOf(plan, name);
    const note = (conceptId: string | undefined, title: string, quote: string) => ({ conceptId, title, body: quote, citations: cite(1, quote) });
    const question = (conceptId: string, prompt: string, right: string, quote: string) => ({ conceptId, level: 1, prompt, choices: [right, 'Wrong one', 'Wrong two', 'Wrong three'], answerIndex: 0, explanation: quote, citations: cite(1, quote) });
    const provider = scripted('', () =>
      JSON.stringify({
        notes: [note(id('Join'), 'Join', S(1, 0)), note(id('Primary key'), 'Primary key', S(1, 2)), note(undefined, 'Foreign key', S(1, 3))],
        questions: [
          question(id('Join'), 'What does a join combine?', 'Rows from two tables', S(1, 0)),
          question(id('Foreign key'), 'What does a foreign key store?', 'The primary key of a row in another table', S(1, 3)),
        ],
      }),
    );
    const { section } = await createLesson(
      {
        documentId: await documentIdFor(joinsPages),
        documentName: joinsSource.name,
        pages: joinsPages.filter((p) => lesson.pages.includes(p.page)),
        lesson,
        concepts: plan.concepts.filter((c) => lesson.conceptIds.includes(c.id)),
        taught: [],
      },
      provider,
      { maxTokens: 6000 },
    );
    const failed = plan.lessons[1];
    const coverage = computeCoverage(plan, [section], [{ lessonId: failed.id, status: 'failed', reason: 'The AI provider returned an error (HTTP 500).' }]);
    const status = (name: string) => coverage.concepts.find((c) => c.name === name)!.status;

    expect(status('Join')).toBe('covered');
    // An untagged note still counts when it cites the concept's page and uses its name.
    expect(status('Foreign key')).toBe('covered');
    expect(status('Primary key')).toBe('partial');
    expect(status('Join condition')).toBe('missing');
    expect(status('Inner join')).toBe('pending');
    expect(status('Self join')).toBe('pending');

    const text = coverage.omissions.join('\n');
    expect(text).toContain('“Primary key” is only partly covered');
    expect(text).toContain('an explanation but no practice question');
    expect(text).toContain('“Join condition” was planned for “Join basics”');
    expect(text).toContain('“Inner join” is not taught yet');
    expect(text).toContain('HTTP 500');
    expect(text).toContain('“Hash join”');
    expect(text).toContain('Page 6 has text that no lesson uses.');

    const page = (n: number) => coverage.pages.find((p) => p.page === n)!.status;
    expect(page(1)).toBe('taught');
    expect(page(3)).toBe('planned');
    expect(page(6)).toBe('omitted');
    expect(page(7)).toBe('sparse');

    const summary = summarizeCoverage(coverage);
    expect(summary.concepts).toBe(10);
    expect(summary.covered).toBe(2);
    expect(summary.pagesOmitted).toEqual([6]);
    expect(summary.pagesWithText).toBe(6);
  });
});

describe('per-course budget', () => {
  it('refuses a request that would exceed the request or token limit, before any AI call', () => {
    const budgets = new CourseBudgets({ maxRequests: 2, maxTokens: 10_000 });
    const first = budgets.begin('course', 4_000);
    // While the first request is running, its worst case is held back.
    expect(budgets.use('course')).toEqual({ requests: 1, maxRequests: 2, tokens: 4_000, maxTokens: 10_000 });
    expect(() => budgets.begin('course', 7_000)).toThrow(BudgetError);
    expect(budgets.use('course').requests).toBe(1);

    first(1_500);
    first(9_999); // settling twice changes nothing
    expect(budgets.use('course').tokens).toBe(1_500);
    budgets.begin('course', 7_000)(7_000);
    expect(() => budgets.begin('course', 10)).toThrow(BudgetError);
    // Another course has its own budget.
    expect(budgets.use('other')).toMatchObject({ requests: 0, tokens: 0 });
  });

  it('starts fresh after the entry expires', () => {
    let now = 0;
    const budgets = new CourseBudgets({ maxRequests: 1, maxTokens: 100 }, 1_000, () => now);
    budgets.begin('course', 50)(50);
    expect(() => budgets.begin('course', 10)).toThrow(BudgetError);
    now = 2_000;
    expect(budgets.use('course')).toMatchObject({ requests: 0, tokens: 0 });
  });
});

describe('adaptive HTTP API', () => {
  const ORIGIN = 'http://localhost:3000';
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  function counting() {
    const inner = new MockProvider();
    const p = {
      id: inner.id,
      model: inner.model,
      calls: 0,
      generate: (req: LessonRequest) => {
        p.calls++;
        return inner.generate(req);
      },
    };
    return p;
  }

  async function start(options: Partial<AppOptions> = {}) {
    const logs: string[] = [];
    server = createServer(
      createApp({ provider: new MockProvider(), allowedOrigins: [ORIGIN], log: (line) => logs.push(line), ...options }),
    );
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
    return { post, logs };
  }

  const lessonBody = (doc: ExtractedDocument, planned: PlanResponse, index: number, taught: string[] = []): LessonGenerateRequest => {
    const lesson = planned.plan.lessons[index];
    return {
      documentId: planned.documentId,
      documentName: doc.name,
      lesson,
      concepts: planned.plan.concepts.filter((c) => lesson.conceptIds.includes(c.id)),
      pages: doc.pages.filter((p) => lesson.pages.includes(p.page)),
      taught,
    };
  };

  it('plans once, generates each lesson separately, and reuses cached results', async () => {
    const provider = counting();
    const { post, logs } = await start({ provider });
    const doc = await extractSample('computing');
    const document = { name: doc.name, pageCount: doc.pageCount, pages: doc.pages };

    const planRes = await post('/api/lessons/plan', { document });
    expect(planRes.status).toBe(200);
    const planned = (await planRes.json()) as PlanResponse;
    expect(planned.documentId).toBe(doc.id);
    expect(planned.cached).toBe(false);
    expect(planned.plan.lessons.length).toBeGreaterThan(0);
    expect(planned.budget.requests).toBe(1);

    for (let i = 0; i < planned.plan.lessons.length; i++) {
      const res = await post('/api/lessons/lesson', lessonBody(doc, planned, i));
      expect(res.status).toBe(200);
      const body = (await res.json()) as LessonGenerateResponse;
      expect(body.section.id).toBe(planned.plan.lessons[i].id);
      expect(body.section.questions.length).toBeGreaterThanOrEqual(2);
      expect(body.budget.requests).toBe(i + 2);
    }
    const requests = 1 + planned.plan.lessons.length;
    expect(provider.calls).toBe(requests);

    // Asking again costs nothing: both stages are served from the cache.
    expect(((await (await post('/api/lessons/plan', { document })).json()) as PlanResponse).cached).toBe(true);
    expect(((await (await post('/api/lessons/lesson', lessonBody(doc, planned, 0))).json()) as LessonGenerateResponse).cached).toBe(true);
    expect(provider.calls).toBe(requests);

    // Logs hold method, path, status and timing only.
    expect(logs.join('\n')).not.toContain('operating system');
    expect(logs.some((l) => l.startsWith('POST /api/lessons/plan 200'))).toBe(true);
  });

  it('stops at the request budget without calling the provider', async () => {
    const provider = counting();
    const { post } = await start({ provider, courseBudget: { maxRequests: 2, maxTokens: 1_000_000 } });
    const doc = await extractSample('computing');
    const planned = (await (await post('/api/lessons/plan', { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } })).json()) as PlanResponse;
    expect((await post('/api/lessons/lesson', lessonBody(doc, planned, 0))).status).toBe(200);
    expect(provider.calls).toBe(2);

    // A different (uncached) lesson request would be the third AI call.
    const over = await post('/api/lessons/lesson', lessonBody(doc, planned, 0, ['Something taught earlier']));
    expect(over.status).toBe(429);
    const body = (await over.json()) as ApiErrorBody;
    expect(body.error.code).toBe('budget_exhausted');
    expect(body.error.message).toContain('already created are kept');
    expect(provider.calls).toBe(2);
  });

  it('stops at the token budget before the first request', async () => {
    const provider = counting();
    const { post } = await start({ provider, courseBudget: { maxRequests: 12, maxTokens: 5_000 } });
    const doc = await extractSample('computing');
    const res = await post('/api/lessons/plan', { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } });
    expect(res.status).toBe(429);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('budget_exhausted');
    expect(provider.calls).toBe(0);
  });

  it('gives document ids it never planned one shared budget, so inventing ids unlocks nothing', async () => {
    const provider = counting();
    const { post } = await start({ provider, courseBudget: { maxRequests: 1, maxTokens: 1_000_000 } });
    const doc = await extractSample('computing');
    // A plan made elsewhere (for example before a backend restart), so this server has no record of it.
    const { documentId, plan } = await createPlan({ name: doc.name, pageCount: doc.pageCount, pages: doc.pages }, new MockProvider(), { maxLessons: 10, maxTokens: 8000 });
    const planned: PlanResponse = { documentId, plan, provider: 'mock', model: 'offline-extractive', cached: false, budget: { requests: 0, maxRequests: 1, tokens: 0, maxTokens: 1 } };

    expect((await post('/api/lessons/lesson', { ...lessonBody(doc, planned, 0), documentId: 'a'.repeat(64) })).status).toBe(200);
    const second = await post('/api/lessons/lesson', { ...lessonBody(doc, planned, 0), documentId: 'b'.repeat(64) });
    expect(second.status).toBe(429);
    expect(((await second.json()) as ApiErrorBody).error.code).toBe('budget_exhausted');
    expect(provider.calls).toBe(1);
  });

  it('rejects a lesson request whose plan does not match the pages sent', async () => {
    const provider = counting();
    const { post } = await start({ provider });
    const doc = await extractSample('computing');
    const planned = (await (await post('/api/lessons/plan', { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } })).json()) as PlanResponse;
    const body = lessonBody(doc, planned, 0);
    const tampered = {
      ...body,
      concepts: body.concepts.map((c) => ({
        ...c,
        name: 'Quantum scheduling',
        evidence: [{ ...c.evidence[0], excerpt: 'Quantum scheduling lets every process run at the same instant.' }],
      })),
    };
    const res = await post('/api/lessons/lesson', tampered);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request');
    expect((await post('/api/lessons/lesson', { documentId: 'nope' })).status).toBe(400);
    // A lesson that names a page that was not sent is refused too.
    const extraPage = { ...body, lesson: { ...body.lesson, pages: [...body.lesson.pages, 99] } };
    expect((await post('/api/lessons/lesson', extraPage)).status).toBe(400);
    expect(provider.calls).toBe(1);
  });
});

describe('adaptive generation driver (browser side)', () => {
  const BUDGET = { requests: 0, maxRequests: 12, tokens: 0, maxTokens: 120_000 };

  /** The real planning and lesson code behind the same interface the browser uses. */
  function localApi(provider: AiProvider, failures: Record<number, { code: string; message: string }> = {}) {
    const api = {
      planCalls: 0,
      lessonCalls: 0,
      async plan(doc: ExtractedDocument): Promise<PlanResponse> {
        api.planCalls++;
        const { documentId, plan } = await createPlan({ name: doc.name, pageCount: doc.pageCount, pages: doc.pages }, provider, { maxLessons: 10, maxTokens: 8000 });
        return { documentId, plan, provider: provider.id, model: provider.model, cached: false, budget: BUDGET };
      },
      async lesson(body: LessonGenerateRequest): Promise<LessonGenerateResponse> {
        const failure = failures[api.lessonCalls++];
        if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
        const result = await createLesson({ ...body, taught: body.taught ?? [] }, provider, { maxTokens: 6000 });
        return { ...result, cached: false, budget: { ...BUDGET, requests: api.lessonCalls + 1 } };
      },
    } satisfies AdaptiveApi & { planCalls: number; lessonCalls: number };
    return api;
  }

  const saver = () => {
    const saved: Course[] = [];
    // Stored the way the browser stores it: as JSON.
    return { saved, save: (course: Course) => saved.push(JSON.parse(JSON.stringify(course)) as Course) > 0 };
  };

  it('builds the whole course, saving after the plan and after every lesson', async () => {
    const doc = await joinsDoc();
    const api = localApi(scripted(rawPlan(FIVE_LESSONS)));
    const { saved, save } = saver();
    const stages: string[] = [];
    const result = await generateAdaptiveCourse({ doc, api, save, onProgress: (p) => stages.push(p.stage === 'lesson' ? `lesson ${p.index + 1}/${p.total}` : p.stage) });

    expect(api.planCalls).toBe(1);
    expect(api.lessonCalls).toBe(5);
    expect(stages).toEqual(['planning', 'lesson 1/5', 'lesson 2/5', 'lesson 3/5', 'lesson 4/5', 'lesson 5/5']);
    expect(saved).toHaveLength(6);
    expect(saved.map((c) => c.sections.length)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result).toMatchObject({ ready: 5, failed: 0, pending: 0 });
    expect(result.stopped).toBeUndefined();

    const course = result.course;
    expect(course.id).toBe(`pdf-${doc.id.slice(0, 12)}`);
    expect(course.title).toBe('SQL Joins');
    expect(course.sections.map((s) => s.id)).toEqual(course.plan!.lessons.map((l) => l.id));
    expect(course.sections.map((s) => s.difficulty)).toEqual(['Beginner', 'Intermediate', 'Intermediate', 'Advanced', 'Advanced']);
    expect(unfinishedLessons(course)).toBe(0);
    // What was saved last is exactly what was returned, and it survives a JSON round trip.
    expect(saved[5]).toEqual(JSON.parse(JSON.stringify(course)));

    // Plan-to-lesson coverage: every planned concept is explained and practised.
    expect(course.coverage!.concepts.map((c) => c.status)).toEqual(course.plan!.concepts.map(() => 'covered'));
    expect(course.coverage!.pages.filter((p) => p.status === 'taught').map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
    expect(course.generation!.report.kept).toBeGreaterThan(0);
  });

  it('unlocks the generated lessons in order and tracks progress', async () => {
    const doc = await joinsDoc();
    const { course } = await generateAdaptiveCourse({ doc, api: localApi(scripted(rawPlan(FIVE_LESSONS))), save: () => true });
    const ids = course.sections.map((s) => s.id);
    const state = { completed: {} as Record<string, { score: number; total: number; xp: number }> };
    expect(sectionStatuses(course.id, ids, state)).toEqual(['active', 'locked', 'locked', 'locked', 'locked']);
    state.completed[sectionKey(course.id, ids[0])] = { score: 2, total: 2, xp: 50 };
    state.completed[sectionKey(course.id, ids[1])] = { score: 1, total: 2, xp: 40 };
    expect(sectionStatuses(course.id, ids, state)).toEqual(['done', 'done', 'active', 'locked', 'locked']);
    expect(courseProgress(course.id, ids, state)).toEqual({ done: 2, total: 5, pct: 40 });
  });

  it('keeps finished lessons when one fails, does not retry it, and can resume later', async () => {
    const doc = await joinsDoc();
    const provider = scripted(rawPlan(FIVE_LESSONS));
    const api = localApi(provider, { 1: { code: 'nothing_grounded', message: 'Too little of this lesson could be matched to your PDF.' } });
    const { saved, save } = saver();
    const result = await generateAdaptiveCourse({ doc, api, save });

    // Five lesson requests for five lessons: the failed one was not asked for twice.
    expect(api.lessonCalls).toBe(5);
    expect(result).toMatchObject({ ready: 4, failed: 1, pending: 0 });
    expect(result.stopped).toBeUndefined();
    const course = saved.at(-1)!;
    const failedLesson = course.plan!.lessons[1];
    expect(course.sections).toHaveLength(4);
    expect(course.sections.map((s) => s.id)).not.toContain(failedLesson.id);
    expect(course.lessonStates!.find((s) => s.lessonId === failedLesson.id)).toMatchObject({ status: 'failed', reason: 'Too little of this lesson could be matched to your PDF.' });
    expect(course.coverage!.concepts.find((c) => c.name === 'Inner join')!.status).toBe('pending');
    expect(course.coverage!.omissions.join('\n')).toContain('“Inner join” is not taught yet');
    expect(unfinishedLessons(course)).toBe(1);
    // The four finished lessons are usable and unlock in order.
    expect(sectionStatuses(course.id, course.sections.map((s) => s.id), { completed: {} })[0]).toBe('active');

    // Resuming reuses the saved plan (no new planning request) and asks only for the missing lesson.
    const again = localApi(provider);
    const resumed = await generateAdaptiveCourse({ doc, api: again, save, resume: course });
    expect(again.planCalls).toBe(0);
    expect(again.lessonCalls).toBe(1);
    expect(resumed).toMatchObject({ ready: 5, failed: 0, pending: 0 });
    expect(resumed.course.sections.map((s) => s.id)).toEqual(course.plan!.lessons.map((l) => l.id));
    expect(resumed.course.sections[0]).toEqual(course.sections[0]);
    expect(resumed.course.generation!.report.kept).toBeGreaterThan(course.generation!.report.kept);
  });

  it('stops spending when the budget runs out, leaving later lessons pending', async () => {
    const doc = await joinsDoc();
    const api = localApi(scripted(rawPlan(FIVE_LESSONS)), { 2: { code: 'budget_exhausted', message: 'This course has used all 12 AI requests in its budget.' } });
    const result = await generateAdaptiveCourse({ doc, api, save: () => true });
    expect(api.lessonCalls).toBe(3);
    expect(result).toMatchObject({ ready: 2, failed: 1, pending: 2 });
    expect(result.stopped).toMatchObject({ code: 'budget_exhausted' });
    expect(result.course.sections).toHaveLength(2);
  });

  it('stops after two lessons fail in a row instead of working through the rest', async () => {
    const doc = await joinsDoc();
    const error = { code: 'provider_error', message: 'The AI provider returned an error (HTTP 500).' };
    const api = localApi(scripted(rawPlan(FIVE_LESSONS)), { 0: error, 1: error });
    const result = await generateAdaptiveCourse({ doc, api, save: () => true });
    expect(api.lessonCalls).toBe(2);
    expect(result).toMatchObject({ ready: 0, failed: 2, pending: 3 });
    expect(result.stopped).toMatchObject({ code: 'repeated_failures' });
  });

  it('does not replace lessons saved earlier until a new lesson exists', async () => {
    const doc = await joinsDoc();
    const error = { code: 'provider_error', message: 'The AI provider returned an error (HTTP 500).' };

    // Regenerating a PDF that already has lessons: both first lessons fail, so nothing is written.
    const failing = saver();
    const failed = await generateAdaptiveCourse({ doc, api: localApi(scripted(rawPlan(FIVE_LESSONS)), { 0: error, 1: error }), save: failing.save, deferFirstSave: true });
    expect(failing.saved).toHaveLength(0);
    expect(failed.stopped).toMatchObject({ code: 'repeated_failures' });

    // When lessons do arrive, the first save already contains a lesson.
    const working = saver();
    await generateAdaptiveCourse({ doc, api: localApi(scripted(rawPlan(FIVE_LESSONS))), save: working.save, deferFirstSave: true });
    expect(working.saved.map((c) => c.sections.length)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the reason a lesson failed when a resumed run stops before reaching it', async () => {
    const doc = await joinsDoc();
    const provider = scripted(rawPlan(FIVE_LESSONS));
    const first = await generateAdaptiveCourse({ doc, api: localApi(provider, { 3: { code: 'nothing_grounded', message: 'Too little matched your PDF.' } }), save: () => true });
    const failedId = first.course.plan!.lessons[3].id;
    // The resumed run is refused by the budget on its first request.
    const resumed = await generateAdaptiveCourse({ doc, api: localApi(provider, { 0: { code: 'budget_exhausted', message: 'Budget used up.' } }), save: () => true, resume: first.course });
    expect(resumed.stopped).toMatchObject({ code: 'budget_exhausted' });
    expect(resumed.course.sections).toHaveLength(4);
    expect(resumed.course.lessonStates!.find((s) => s.lessonId === failedId)).toMatchObject({ status: 'failed' });
  });

  it('makes no lesson requests when the course cannot be saved, and reports a failed plan as is', async () => {
    const doc = await joinsDoc();
    const api = localApi(scripted(rawPlan(FIVE_LESSONS)));
    const result = await generateAdaptiveCourse({ doc, api, save: () => false });
    expect(api.lessonCalls).toBe(0);
    expect(result.stopped).toMatchObject({ code: 'storage' });

    const broken = localApi(scripted('not a plan'));
    await expect(generateAdaptiveCourse({ doc, api: broken, save: () => true })).rejects.toMatchObject({ code: 'invalid_ai_output' });
    expect(broken.lessonCalls).toBe(0);
  });

  it('works end to end in offline sample mode for each sample PDF', async () => {
    for (const key of ['biology', 'history', 'computing'] as const) {
      const doc = await extractSample(key);
      const api = localApi(new MockProvider());
      const result = await generateAdaptiveCourse({ doc, api, save: () => true });
      expect(result.failed).toBe(0);
      expect(result.course.sections.length).toBe(result.course.plan!.lessons.length);
      expect(api.planCalls + api.lessonCalls).toBe(1 + result.course.plan!.lessons.length);
      expect(result.course.coverage!.concepts.every((c) => c.status === 'covered')).toBe(true);
    }
  });
});
