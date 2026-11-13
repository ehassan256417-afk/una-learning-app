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

export const rawNote = z.object({
  title: text(120),
  body: text(900),
  keyTerm: z.string().trim().max(80).optional(),
  citations,
});

export const rawQuestion = z
  .object({
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

export function parseLessonJson(raw: string): RawLesson {
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
  if (!data || typeof data !== 'object' || !Array.isArray((data as { sections?: unknown }).sections)) {
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
