import type { ExtractedPage } from '../lib/learning/contracts.ts';
import { validateSectionGrounding } from '../lib/learning/grounding.ts';
import type {
  Course,
  Difficulty,
  Flashcard,
  LearningLevel,
  NoteCard,
  Provenance,
  QuizQuestion,
  Section,
  SourceCitation,
} from '../lib/learning/types.ts';
import { PageIndex, verifyItem, type RawCitation } from '../lib/learning/verify.ts';
import { documentIdFor } from '../lib/pdf/extract.ts';
import { buildPrompt, fitPagesToBudget, SYSTEM_PROMPT } from './prompt.ts';
import type { AiProvider } from './providers/types.ts';
import { LessonParseError, parseLessonJson, type RawLesson, type RawSection } from './schema.ts';

export type GenerationErrorCode = 'invalid_ai_output' | 'nothing_grounded';

export class GenerationError extends Error {
  code: GenerationErrorCode;

  constructor(code: GenerationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GenerationError';
  }
}

export interface SourceDocument {
  name: string;
  pageCount: number;
  pages: ExtractedPage[];
}

const LEVEL_ORDER: Difficulty[] = ['Beginner', 'Intermediate', 'Advanced'];
const XP_REWARD: Record<Difficulty, number> = { Beginner: 30, Intermediate: 40, Advanced: 50 };
const MIN_NOTES = 1;
const MIN_QUESTIONS = 2;

interface Tally {
  checked: number;
  kept: number;
  reasons: string[];
}

/** Runs the grounding check for one item and records the outcome. */
function check(
  kind: string,
  claim: string,
  citations: RawCitation[],
  index: PageIndex,
  documentId: string,
  tally: Tally,
): SourceCitation[] | null {
  tally.checked++;
  const result = verifyItem(claim, citations, index, documentId);
  if (result.ok) {
    tally.kept++;
    return result.citations;
  }
  if (tally.reasons.length < 8) tally.reasons.push(`${kind}: ${result.reason}`);
  return null;
}

function buildSection(raw: RawSection, index: PageIndex, documentId: string, tally: Tally): Section | null {
  const id = raw.level.toLowerCase();
  const pdf = (citations: SourceCitation[]): Provenance => ({ kind: 'pdf', documentId, citations });

  const notes: NoteCard[] = [];
  raw.notes.forEach((n, i) => {
    const citations = check('note', n.body, n.citations, index, documentId, tally);
    if (!citations) return;
    const keyTerm = n.keyTerm && n.body.toLowerCase().includes(n.keyTerm.toLowerCase()) ? n.keyTerm : undefined;
    notes.push({ id: `${id}-n${i + 1}`, title: n.title, body: n.body, keyTerm, provenance: pdf(citations) });
  });

  const questions: QuizQuestion[] = [];
  raw.questions.forEach((q, i) => {
    const claim = `${q.choices[q.answerIndex]} ${q.explanation}`;
    const citations = check('question', claim, q.citations, index, documentId, tally);
    if (!citations) return;
    const level = q.level as LearningLevel;
    questions.push({
      id: `${id}-q${i + 1}`,
      level,
      prompt: q.prompt,
      choices: q.choices,
      answerIndex: q.answerIndex,
      explanation: q.explanation,
      xp: level * 10,
      provenance: pdf(citations),
    });
  });

  const flashcards: Flashcard[] = [];
  raw.flashcards.forEach((f, i) => {
    const citations = check('flashcard', f.back, f.citations, index, documentId, tally);
    if (citations) flashcards.push({ id: `${id}-f${i + 1}`, front: f.front, back: f.back, provenance: pdf(citations) });
  });

  const keyPoints: string[] = [];
  for (const k of raw.keyPoints) {
    if (check('key point', k.text, k.citations, index, documentId, tally)) keyPoints.push(k.text);
  }

  if (notes.length < MIN_NOTES || questions.length < MIN_QUESTIONS) return null;

  // A flashcard deck is optional in the model output; fall back to the notes' key terms.
  if (flashcards.length === 0) {
    for (const n of notes) {
      flashcards.push({ id: `${n.id}-card`, front: n.keyTerm ?? n.title, back: n.body, provenance: n.provenance });
    }
  }

  const sectionCitations = notes
    .flatMap((n) => (n.provenance.kind === 'pdf' ? n.provenance.citations : []))
    .slice(0, 3);
  const minutes = 2 + notes.length + questions.length;
  const section: Section = {
    id,
    title: raw.title,
    estMinutes: `${minutes}–${minutes + 2} min`,
    difficulty: raw.level,
    xpReward: XP_REWARD[raw.level],
    objectives: raw.objectives.slice(0, 3),
    keyPoints: keyPoints.length ? keyPoints : notes.map((n) => n.title),
    notes,
    questions: questions.sort((a, b) => a.level - b.level),
    flashcards,
    provenance: pdf(sectionCitations),
  };
  // Structural safety net: every kept item must carry a usable citation.
  return validateSectionGrounding(section).length === 0 ? section : null;
}

async function requestLesson(provider: AiProvider, document: SourceDocument): Promise<RawLesson> {
  const pages = fitPagesToBudget(document.pages);
  const request = { system: SYSTEM_PROMPT, prompt: buildPrompt(document.name, pages), pages };
  let lastError: unknown;
  // One retry: models occasionally return malformed JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseLessonJson(await provider.generate(request));
    } catch (err) {
      if (!(err instanceof LessonParseError)) throw err;
      lastError = err;
    }
  }
  throw new GenerationError(
    'invalid_ai_output',
    lastError instanceof Error ? lastError.message : 'The AI response could not be read.',
  );
}

/**
 * Document text in, verified course out. Anything the model wrote that cannot
 * be matched to the PDF is removed before the course is returned.
 */
export async function generateCourse(document: SourceDocument, provider: AiProvider): Promise<Course> {
  const documentId = await documentIdFor(document.pages);
  const raw = await requestLesson(provider, document);
  const index = new PageIndex(document.pages);
  const tally: Tally = { checked: raw.malformed, kept: 0, reasons: [] };

  const byLevel = new Map<Difficulty, Section>();
  for (const rawSection of raw.sections) {
    if (byLevel.has(rawSection.level)) continue;
    const section = buildSection(rawSection, index, documentId, tally);
    if (section) byLevel.set(rawSection.level, section);
  }
  const sections = LEVEL_ORDER.flatMap((level) => byLevel.get(level) ?? []);
  if (sections.length === 0) {
    throw new GenerationError(
      'nothing_grounded',
      'None of the generated content could be matched to your PDF, so no lesson was created.',
    );
  }

  const baseName = document.name.replace(/\.pdf$/i, '').slice(0, 60) || 'Uploaded PDF';
  return {
    id: `pdf-${documentId.slice(0, 12)}`,
    code: 'PDF',
    title: raw.title || baseName,
    unitLabel: 'Your PDF',
    unitTitle: baseName,
    pages: document.pageCount,
    accent: 'gold',
    sections,
    provenance: { kind: 'pdf', documentId, citations: [] },
    generation: {
      provider: provider.id,
      model: provider.model,
      createdAt: new Date().toISOString(),
      documentName: document.name,
      report: {
        checked: tally.checked,
        kept: tally.kept,
        dropped: tally.checked - tally.kept,
        reasons: tally.reasons,
      },
    },
  };
}
