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
  /** Result of the automated quote check: found word for word, or with small differences. */
  support?: 'exact' | 'close';
}

/** Summary of the automated grounding check for one generated course. */
export interface GroundingReport {
  /** Items the AI produced. */
  checked: number;
  /** Items whose quotes were found in the PDF. */
  kept: number;
  /** Items removed because they could not be matched to the PDF. */
  dropped: number;
  /** A few example reasons, for display. */
  reasons: string[];
}

export interface GenerationInfo {
  provider: string;
  model: string;
  createdAt: string;
  documentName: string;
  report: GroundingReport;
}

/** A concept found in the PDF during planning, with the quotes that prove it is there. */
export interface PlanConcept {
  id: string;
  name: string;
  /** One sentence saying what the concept is, from the PDF. */
  summary: string;
  difficulty: Difficulty;
  /** Core concepts must be taught; supporting ones are taught when the budget allows. */
  importance: 'core' | 'supporting';
  /** Pages the concept appears on (confirmed by its evidence quotes). */
  pages: number[];
  /** Ids of other concepts in the same plan that should be learned first. */
  prerequisites: string[];
  evidence: SourceCitation[];
}

/** One lesson in the adaptive plan. It becomes a `Section` once generated. */
export interface PlannedLesson {
  id: string;
  title: string;
  difficulty: Difficulty;
  conceptIds: string[];
  objectives: string[];
  pages: number[];
}

/** Something the planner proposed that was left out, and why. */
export interface FlaggedItem {
  name: string;
  reason: string;
  pages: number[];
}

export interface LessonPlan {
  version: 1;
  title: string;
  concepts: PlanConcept[];
  lessons: PlannedLesson[];
  flagged: FlaggedItem[];
  /** Amount of text on each page, kept so coverage can be recalculated without the PDF. */
  pageChars: Array<{ page: number; chars: number }>;
}

export interface LessonState {
  lessonId: string;
  status: 'pending' | 'ready' | 'failed';
  /** Why a lesson failed, in words a student can read. */
  reason?: string;
}

export interface ConceptCoverage {
  conceptId: string;
  name: string;
  importance: PlanConcept['importance'];
  pages: number[];
  /** covered: explained and practised. partial: only one of the two. missing: neither. pending: lesson not generated. */
  status: 'covered' | 'partial' | 'missing' | 'pending';
  lessonId?: string;
}

export interface PageCoverage {
  page: number;
  chars: number;
  /** taught: a kept item cites it. planned: in a concept but not cited yet. sparse: almost no text. omitted: text no lesson uses. */
  status: 'taught' | 'planned' | 'sparse' | 'omitted';
}

/**
 * Result of the automated coverage check. It compares the plan with what was
 * generated; it cannot tell whether the plan itself missed something subtle.
 */
export interface CoverageReport {
  concepts: ConceptCoverage[];
  pages: PageCoverage[];
  /** Plain-language list of what was left out or is still missing. */
  omissions: string[];
}

export interface BudgetUse {
  requests: number;
  maxRequests: number;
  tokens: number;
  maxTokens: number;
}

/** Which part of the explanation a note gives. */
export type NoteAspect = 'what' | 'why' | 'how' | 'example';

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
  /** Adaptive lessons: which part of the explanation this is, and the concept it teaches. */
  aspect?: NoteAspect;
  conceptId?: string;
  provenance: Provenance;
}

export interface QuizQuestion {
  id: string;
  /** Adaptive lessons: the concept this question practises. */
  conceptId?: string;
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
  /** Adaptive lessons: the planned concepts this lesson teaches and the pages it draws on. */
  conceptIds?: string[];
  pages?: number[];
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
  /** Present on courses generated from an uploaded PDF. */
  generation?: GenerationInfo;
  /** Present on adaptively generated courses. `sections` holds only the lessons generated so far. */
  plan?: LessonPlan;
  lessonStates?: LessonState[];
  coverage?: CoverageReport;
  budget?: BudgetUse;
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
  generation?: GenerationInfo;
}

export const isDemo = (p: Provenance): p is { kind: 'demo' } => p.kind === 'demo';
