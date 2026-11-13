import type { ExtractedPage } from '../../lib/learning/contracts.ts';
import { contentWords } from '../../lib/learning/verify.ts';
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

export class MockProvider implements AiProvider {
  readonly id = 'mock';
  readonly model = 'offline-extractive';

  async generate(request: LessonRequest): Promise<string> {
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
