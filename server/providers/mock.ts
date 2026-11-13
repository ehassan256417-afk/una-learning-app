import type { ExtractedPage } from '../../lib/learning/contracts.ts';
import { contentWords } from '../../lib/learning/verify.ts';
import type { PlanConcept } from '../../lib/learning/types.ts';
import type { AiProvider, LessonRequest } from './types.ts';

/**
 * Offline provider used for tests and local development without an API key.
 *
 * It does not call any AI service. It builds lessons by copying sentences from
 * the document (notes) and blanking out one word (questions), so its output is
 * crude but always traceable to a page. The UI labels it as offline sample mode.
 */

interface Sentence {
  page: number;
  text: string;
}

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

export function splitSentences(pages: ExtractedPage[]): Sentence[] {
  const out: Sentence[] = [];
  for (const p of pages) {
    for (const raw of p.text.split(/(?<=[.!?])\s+/)) {
      const text = raw.trim();
      const words = text.split(/\s+/).length;
      if (text.length >= 40 && text.length <= 260 && words >= 7) out.push({ page: p.page, text });
    }
  }
  return out;
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Longest plain word in the sentence; used as the blank in a cloze question. */
function targetWord(sentence: string): string | null {
  const words = sentence.match(/[A-Za-z]{6,}/g) ?? [];
  const usable = words.filter((w) => contentWords(w).length > 0);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.length > a.length ? b : a));
}

const vocabularyOf = (sentences: Sentence[]) => [
  ...new Set(sentences.flatMap((s) => s.text.match(/[A-Za-z]{6,}/g) ?? []).map((w) => w.toLowerCase())),
];

/** A fill-in-the-blank question built from one sentence, or null if it has no usable word. */
function cloze(s: Sentence, vocabulary: string[], level: number, conceptId?: string) {
  const word = targetWord(s.text);
  if (!word) return null;
  const others = vocabulary.filter((w) => w !== word.toLowerCase());
  const start = others.length ? hash(s.text) % others.length : 0;
  const choices = [...new Set([0, 1, 2].map((k) => others[(start + k * 7) % Math.max(1, others.length)] ?? `option ${k + 1}`))];
  while (choices.length < 3) choices.push(`none of these (${choices.length + 1})`);
  const answerIndex = hash(word + s.page) % 4;
  choices.splice(answerIndex, 0, word.toLowerCase());
  return {
    ...(conceptId ? { conceptId } : {}),
    level,
    prompt: `Fill in the blank from page ${s.page}: "${s.text.replace(word, '_____')}"`,
    choices,
    answerIndex,
    explanation: `Page ${s.page} says: "${s.text}"`,
    citations: [{ page: s.page, quote: s.text }],
  };
}

const firstWords = (text: string, n: number) => cap(text.split(/\s+/).slice(0, n).join(' ').replace(/[,;:.]+$/, ''));

/** Offline stand-in for the planning request: one concept per page that has text, grouped a few per lesson. */
function mockPlan(pages: ExtractedPage[], maxLessons: number): string {
  const byPage = pages
    .map((p) => ({ page: p.page, sentences: splitSentences([p]) }))
    .filter((p) => p.sentences.length >= 2);
  const levelAt = (i: number) => LEVELS[Math.min(2, Math.floor((i * 3) / Math.max(1, byPage.length)))];
  const concepts = byPage.map((p, i) => ({
    id: `m${i + 1}`,
    name: firstWords(p.sentences[0].text, 5),
    summary: p.sentences[0].text,
    difficulty: levelAt(i),
    importance: 'core',
    pages: [p.page],
    prerequisites: i > 0 ? [`m${i}`] : [],
    evidence: [{ page: p.page, quote: p.sentences[0].text }],
  }));
  const size = Math.min(4, Math.max(2, Math.ceil(concepts.length / Math.max(1, maxLessons))));
  const lessons = [];
  for (let i = 0; i < concepts.length; i += size) {
    const group = concepts.slice(i, i + size);
    lessons.push({
      title: `${group[0].name}…`,
      difficulty: group[0].difficulty,
      conceptIds: group.map((c) => c.id),
      objectives: [],
    });
  }
  return JSON.stringify({ title: '', concepts, lessons });
}

/** Offline stand-in for one lesson request: copies sentences from the concept's pages and blanks out words. */
function mockLesson(pages: ExtractedPage[], concepts: PlanConcept[]): string {
  const all = splitSentences(pages);
  const vocabulary = vocabularyOf(all);
  const notes = [];
  const questions = [];
  const flashcards = [];
  for (const c of concepts) {
    const own = all.filter((s) => c.pages.includes(s.page));
    if (own.length === 0) continue;
    const cite = (s: Sentence) => [{ page: s.page, quote: s.text }];
    notes.push({ conceptId: c.id, aspect: 'what', title: c.name, body: own[0].text, keyTerm: targetWord(own[0].text) ?? undefined, citations: cite(own[0]) });
    if (own[2]) notes.push({ conceptId: c.id, aspect: 'how', title: `${firstWords(own[2].text, 5)}…`, body: own[2].text, citations: cite(own[2]) });
    let made = 0;
    for (const s of own) {
      if (made >= 2) break;
      const q = cloze(s, vocabulary, (questions.length % 3) + 1, c.id);
      if (!q) continue;
      questions.push(q);
      made++;
    }
    const word = targetWord(own[0].text);
    if (word) flashcards.push({ front: cap(word.toLowerCase()), back: own[0].text, citations: cite(own[0]) });
  }
  const keyPoints = all.slice(0, 2).map((s) => ({ text: s.text, citations: [{ page: s.page, quote: s.text }] }));
  return JSON.stringify({ keyPoints, notes, questions, flashcards });
}

export class MockProvider implements AiProvider {
  readonly id = 'mock';
  readonly model = 'offline-extractive';

  async generate(request: LessonRequest): Promise<string> {
    const output =
      request.task?.kind === 'plan'
        ? mockPlan(request.pages, request.task.maxLessons)
        : request.task?.kind === 'lesson'
          ? mockLesson(request.pages, request.task.concepts)
          : this.course(request);
    // No real tokens are used; the estimate keeps budget accounting exercised offline.
    request.onUsage?.({
      promptTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
      outputTokens: Math.ceil(output.length / 4),
      estimated: true,
    });
    return output;
  }

  private course(request: LessonRequest): string {
    const sentences = splitSentences(request.pages);
    const vocabulary = [
      ...new Set(sentences.flatMap((s) => s.text.match(/[A-Za-z]{6,}/g) ?? []).map((w) => w.toLowerCase())),
    ];
    const third = Math.ceil(sentences.length / 3);

    const sections = LEVELS.map((level, li) => {
      const group = sentences.slice(li * third, (li + 1) * third);
      const cite = (s: Sentence) => [{ page: s.page, quote: s.text }];

      const notes = group.slice(0, 3).map((s, i) => ({
        title: `${cap(s.text.split(/\s+/).slice(0, 5).join(' ').replace(/[,;:.]+$/, ''))}…`,
        body: group[i + 3] && group[i + 3].page === s.page ? `${s.text} ${group[i + 3].text}` : s.text,
        keyTerm: targetWord(s.text) ?? undefined,
        citations: cite(s),
      }));

      const questions = group
        .slice(0, 6)
        .map((s) => ({ s, word: targetWord(s.text) }))
        .filter((x): x is { s: Sentence; word: string } => x.word !== null)
        .slice(0, 3)
        .map(({ s, word }, qi) => {
          const others = vocabulary.filter((w) => w !== word.toLowerCase());
          const start = others.length ? hash(s.text) % others.length : 0;
          const distractors = [0, 1, 2].map((k) => others[(start + k * 7) % Math.max(1, others.length)] ?? `option ${k + 1}`);
          const answerIndex = hash(word + s.page) % 4;
          const choices = [...new Set(distractors)].filter((d) => d !== word.toLowerCase());
          while (choices.length < 3) choices.push(`none of these (${choices.length + 1})`);
          choices.splice(answerIndex, 0, word.toLowerCase());
          return {
            level: qi + 1,
            prompt: `Fill in the blank from page ${s.page}: "${s.text.replace(word, '_____')}"`,
            choices,
            answerIndex,
            explanation: `Page ${s.page} says: "${s.text}"`,
            citations: cite(s),
          };
        });

      const flashcards = group
        .slice(0, 6)
        .map((s) => ({ s, word: targetWord(s.text) }))
        .filter((x): x is { s: Sentence; word: string } => x.word !== null)
        .slice(0, 3)
        .map(({ s, word }) => ({ front: cap(word.toLowerCase()), back: s.text, citations: cite(s) }));

      return {
        level,
        title: `${level} review`,
        objectives: ['Read the key statements from this part of your PDF.', 'Recall important terms in context.'],
        keyPoints: group.slice(0, 3).map((s) => ({ text: s.text, citations: cite(s) })),
        notes,
        questions,
        flashcards,
      };
    });

    return JSON.stringify({ title: '', sections });
  }
}
