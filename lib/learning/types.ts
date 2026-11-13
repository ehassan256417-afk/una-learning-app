/**
 * Domain model for UNA Learning.
 *
 * Every piece of learning content carries a `Provenance`. Today everything is
 * `{ kind: 'demo' }` (hand-written sample data). The future PDF AI Learning
 * Engine must emit `{ kind: 'pdf' }` content whose citations point at stored
 * page excerpts of the student's uploaded document. The UI reads provenance to
 * decide whether to show a "Demo data" label or a page citation.
 */

/** A verbatim excerpt from an uploaded document that supports a claim. */
export interface SourceCitation {
  documentId: string;
  /** 1-based page number in the uploaded PDF. */
  page: number;
  /** Verbatim text copied from that page. */
  excerpt: string;
}

export type Provenance =
  | { kind: 'demo' }
  | { kind: 'pdf'; documentId: string; citations: SourceCitation[] };

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

/** The three learning levels each section moves through. */
export type LearningLevel = 1 | 2 | 3;

export const LEVEL_LABELS: Record<LearningLevel, { title: string; subtitle: string }> = {
  1: { title: 'Level 1', subtitle: 'Learn the Basics' },
  2: { title: 'Level 2', subtitle: 'Apply & Practice' },
  3: { title: 'Level 3', subtitle: 'Challenge' },
};

export interface NoteCard {
  id: string;
  title: string;
  body: string;
  /** A term in `body` to highlight. */
  keyTerm?: string;
  /** Optional command / code sample shown in a terminal block. */
  example?: string;
  provenance: Provenance;
}

export interface QuizQuestion {
  id: string;
  level: LearningLevel;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  xp: number;
  provenance: Provenance;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  provenance: Provenance;
}

export interface Section {
  id: string;
  title: string;
  estMinutes: string;
  difficulty: Difficulty;
  /** Bonus XP for finishing the section, on top of per-question XP. */
  xpReward: number;
  objectives: string[];
  keyPoints: string[];
  notes: NoteCard[];
  questions: QuizQuestion[];
  flashcards: Flashcard[];
  provenance: Provenance;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  /** e.g. "Module 4" */
  unitLabel: string;
  unitTitle: string;
  /** Page count of the source document (demo value until a PDF is ingested). */
  pages: number;
  accent: 'purple' | 'gold';
  sections: Section[];
  provenance: Provenance;
}

/** Lightweight course listing (no lesson bodies). */
export interface CourseSummary {
  id: string;
  code: string;
  title: string;
  unitLabel: string;
  unitTitle: string;
  pages: number;
  accent: Course['accent'];
  sectionIds: string[];
  provenance: Provenance;
}

export const isDemo = (p: Provenance): p is { kind: 'demo' } => p.kind === 'demo';
