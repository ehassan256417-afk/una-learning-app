import { z } from 'zod';

/**
 * The JSON structure the AI provider must return, before verification.
 * Parsing is forgiving per item: one malformed note or question is dropped
 * (and counted) instead of failing the whole response.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

const citation = z.object({
  page: z.coerce.number().int().min(1).max(100_000),
  quote: text(800),
});
const citations = z.array(citation).max(6).default([]);

/** Optional extras used by adaptive lessons. A bad value is ignored, not a reason to drop the item. */
const conceptRef = z.string().trim().min(1).max(40).optional().catch(undefined);

export const rawNote = z.object({
  title: text(120),
  body: text(900),
  keyTerm: z.string().trim().max(80).optional(),
  citations,
  aspect: z.enum(['what', 'why', 'how', 'example']).optional().catch(undefined),
  conceptId: conceptRef,
  example: z.string().max(1500).optional().catch(undefined),
});

export const rawQuestion = z
  .object({
    conceptId: conceptRef,
    level: z.coerce.number().int().min(1).max(3),
    prompt: text(500),
    choices: z.array(text(300)).length(4),
    answerIndex: z.coerce.number().int().min(0).max(3),
    explanation: text(700),
    citations,
  })
  .refine((q) => new Set(q.choices.map((c) => c.toLowerCase())).size === 4, 'choices must be distinct');

export const rawFlashcard = z.object({ front: text(120), back: text(400), citations });
export const rawKeyPoint = z.object({ text: text(400), citations });

const levelName = z.enum(['Beginner', 'Intermediate', 'Advanced']);

export type RawNote = z.infer<typeof rawNote>;
export type RawQuestion = z.infer<typeof rawQuestion>;
export type RawFlashcard = z.infer<typeof rawFlashcard>;
export type RawKeyPoint = z.infer<typeof rawKeyPoint>;

export interface RawSection {
  level: z.infer<typeof levelName>;
  title: string;
  objectives: string[];
  keyPoints: RawKeyPoint[];
  notes: RawNote[];
  questions: RawQuestion[];
  flashcards: RawFlashcard[];
}

export interface RawLesson {
  title: string;
  sections: RawSection[];
  /** Items that did not match the schema and were discarded. */
  malformed: number;
}

export class LessonParseError extends Error {}

function pick<T>(schema: z.ZodType<T>, value: unknown, max: number, count: { malformed: number }): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value.slice(0, max)) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else count.malformed++;
  }
  return out;
}

function parseObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new LessonParseError('The AI response was not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new LessonParseError('The AI response was not a JSON object.');
  }
  return data as Record<string, unknown>;
}

const pageList = z
  .array(z.coerce.number().int().min(1).max(100_000))
  .max(80)
  .catch([]);
const idList = (max: number) => z.array(z.coerce.string().trim().min(1).max(40)).max(max).catch([]);

export const rawConcept = z.object({
  id: z.coerce.string().trim().min(1).max(40),
  name: text(120),
  summary: text(400),
  difficulty: levelName.catch('Beginner'),
  importance: z.enum(['core', 'supporting']).catch('core'),
  pages: pageList,
  prerequisites: idList(12),
  evidence: citations,
});

export const rawPlannedLesson = z.object({
  title: text(120),
  difficulty: levelName.optional().catch(undefined),
  conceptIds: z.array(z.coerce.string().trim().min(1).max(40)).min(1).max(16),
  objectives: z.array(text(200)).max(5).catch([]),
});

export type RawConcept = z.infer<typeof rawConcept>;
export type RawPlannedLesson = z.infer<typeof rawPlannedLesson>;

export interface RawPlan {
  title: string;
  concepts: RawConcept[];
  lessons: RawPlannedLesson[];
  malformed: number;
}

/** The planning response: concepts found in the PDF and how to group them into lessons. */
export function parsePlanJson(raw: string): RawPlan {
  const root = parseObject(raw);
  if (!Array.isArray(root.concepts)) throw new LessonParseError('The AI response did not contain a "concepts" list.');
  const count = { malformed: 0 };
  const concepts = pick(rawConcept, root.concepts, 60, count);
  if (concepts.length === 0) throw new LessonParseError('The AI response had no usable concepts.');
  return {
    title: typeof root.title === 'string' ? root.title.trim().slice(0, 80) : '',
    concepts,
    lessons: pick(rawPlannedLesson, root.lessons, 40, count),
    malformed: count.malformed,
  };
}

export interface RawLessonContent {
  objectives: string[];
  keyPoints: RawKeyPoint[];
  notes: RawNote[];
  questions: RawQuestion[];
  flashcards: RawFlashcard[];
  malformed: number;
}

/** One adaptive lesson: the body of a single section, without level or title (the plan sets those). */
export function parseLessonContentJson(raw: string): RawLessonContent {
  const root = parseObject(raw);
  if (!Array.isArray(root.notes) || !Array.isArray(root.questions)) {
    throw new LessonParseError('The AI response did not contain "notes" and "questions" lists.');
  }
  const count = { malformed: 0 };
  return {
    objectives: pick(text(200), root.objectives, 4, count),
    keyPoints: pick(rawKeyPoint, root.keyPoints, 6, count),
    notes: pick(rawNote, root.notes, 10, count),
    questions: pick(rawQuestion, root.questions, 8, count),
    flashcards: pick(rawFlashcard, root.flashcards, 10, count),
    malformed: count.malformed,
  };
}

export function parseLessonJson(raw: string): RawLesson {
  const data = parseObject(raw);
  if (!Array.isArray((data as { sections?: unknown }).sections)) {
    throw new LessonParseError('The AI response did not contain a "sections" list.');
  }
  const root = data as { title?: unknown; sections: unknown[] };
  const count = { malformed: 0 };
  const sections: RawSection[] = [];
  for (const s of root.sections.slice(0, 6)) {
    const head = z.object({ level: levelName, title: text(120) }).safeParse(s);
    if (!head.success) {
      count.malformed++;
      continue;
    }
    const body = s as Record<string, unknown>;
    sections.push({
      ...head.data,
      objectives: pick(text(200), body.objectives, 4, count),
      keyPoints: pick(rawKeyPoint, body.keyPoints, 4, count),
      notes: pick(rawNote, body.notes, 4, count),
      questions: pick(rawQuestion, body.questions, 5, count),
      flashcards: pick(rawFlashcard, body.flashcards, 5, count),
    });
  }
  if (sections.length === 0) throw new LessonParseError('The AI response had no usable sections.');
  return {
    title: typeof root.title === 'string' ? root.title.trim().slice(0, 80) : '',
    sections,
    malformed: count.malformed,
  };
}
