import type {
  ConceptCoverage,
  CoverageReport,
  LessonPlan,
  LessonState,
  PageCoverage,
  PlanConcept,
  Provenance,
  Section,
} from './types.ts';
import { contentWords } from './verify.ts';

/**
 * Coverage check for an adaptively generated course.
 *
 * It compares the verified plan with the lessons that were actually kept after
 * grounding, and lists what is missing in plain words. It is a bookkeeping
 * check: it shows that every planned concept has an explanation and a practice
 * question that passed the quote checks. It cannot tell whether the plan itself
 * overlooked something, or whether an explanation is correct.
 */

/** Pages with less text than this are reported as sparse, not as omitted content. */
const SPARSE_PAGE_CHARS = 200;

const citedPages = (p: Provenance): number[] => (p.kind === 'pdf' ? p.citations.map((c) => c.page) : []);

/**
 * Does an item teach this concept? The model's tag alone is not trusted.
 * A tagged item must also cite one of the concept's pages or use at least half
 * of the key words in the concept's name. An untagged item must do both.
 */
function teaches(text: string, taggedWith: string | undefined, pages: number[], concept: PlanConcept): boolean {
  if (taggedWith && taggedWith !== concept.id) return false;
  const onPage = pages.some((p) => concept.pages.includes(p));
  const words = [...new Set(contentWords(concept.name))];
  const have = new Set(contentWords(text));
  const named = words.length > 0 && words.filter((w) => have.has(w)).length / words.length >= 0.5;
  return taggedWith ? onPage || named : onPage && named;
}

const listPages = (pages: number[]) => (pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(', ')}`);

export function computeCoverage(plan: LessonPlan, sections: Section[], states: LessonState[] = []): CoverageReport {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const stateById = new Map(states.map((s) => [s.lessonId, s]));
  const omissions: string[] = plan.flagged.map(
    (f) => `“${f.name}”${f.pages.length ? ` (${listPages(f.pages)})` : ''}: ${f.reason}`,
  );

  const concepts: ConceptCoverage[] = plan.concepts.map((c) => {
    const base = { conceptId: c.id, name: c.name, importance: c.importance, pages: c.pages };
    const lesson = plan.lessons.find((l) => l.conceptIds.includes(c.id));
    // Concepts left out of the plan are already explained in `flagged`.
    if (!lesson) return { ...base, status: 'missing' };
    const section = sectionById.get(lesson.id);
    if (!section) {
      const state = stateById.get(lesson.id);
      omissions.push(
        state?.status === 'failed'
          ? `“${c.name}” is not taught yet: the lesson “${lesson.title}” could not be generated${state.reason ? ` (${state.reason})` : ''}.`
          : `“${c.name}” is planned, but the lesson “${lesson.title}” has not been generated yet.`,
      );
      return { ...base, status: 'pending', lessonId: lesson.id };
    }
    const explained = section.notes.some((n) => teaches(`${n.title} ${n.body}`, n.conceptId, citedPages(n.provenance), c));
    const practised = section.questions.some((q) =>
      teaches(`${q.prompt} ${q.choices[q.answerIndex]} ${q.explanation}`, q.conceptId, citedPages(q.provenance), c),
    );
    if (explained && practised) return { ...base, status: 'covered', lessonId: lesson.id };
    if (!explained && !practised) {
      omissions.push(
        `“${c.name}” was planned for “${lesson.title}”, but nothing about it passed the checks against your PDF.`,
      );
      return { ...base, status: 'missing', lessonId: lesson.id };
    }
    omissions.push(
      `“${c.name}” is only partly covered in “${lesson.title}”: it has ${
        explained ? 'an explanation but no practice question' : 'a practice question but no explanation'
      }.`,
    );
    return { ...base, status: 'partial', lessonId: lesson.id };
  });

  const taught = new Set(
    sections.flatMap((s) => [...s.notes, ...s.questions, ...s.flashcards].flatMap((item) => citedPages(item.provenance))),
  );
  const planned = new Set(
    plan.concepts.filter((c) => plan.lessons.some((l) => l.conceptIds.includes(c.id))).flatMap((c) => c.pages),
  );
  const pages: PageCoverage[] = plan.pageChars.map(({ page, chars }) => ({
    page,
    chars,
    status: taught.has(page) ? 'taught' : chars < SPARSE_PAGE_CHARS ? 'sparse' : planned.has(page) ? 'planned' : 'omitted',
  }));
  const omitted = pages.filter((p) => p.status === 'omitted').map((p) => p.page);
  if (omitted.length) {
    omissions.push(
      `${omitted.length === 1 ? `Page ${omitted[0]} has` : `Pages ${omitted.join(', ')} have`} text that no lesson uses.`,
    );
  }
  return { concepts, pages, omissions };
}

export interface CoverageSummary {
  concepts: number;
  covered: number;
  /** Core concepts that are not fully covered (partial, missing or not generated yet). */
  coreOpen: number;
  pagesWithText: number;
  pagesTaught: number;
  pagesOmitted: number[];
}

export function summarizeCoverage(report: CoverageReport): CoverageSummary {
  const withText = report.pages.filter((p) => p.status !== 'sparse');
  return {
    concepts: report.concepts.length,
    covered: report.concepts.filter((c) => c.status === 'covered').length,
    coreOpen: report.concepts.filter((c) => c.importance === 'core' && c.status !== 'covered').length,
    pagesWithText: withText.length,
    pagesTaught: withText.filter((p) => p.status === 'taught').length,
    pagesOmitted: report.pages.filter((p) => p.status === 'omitted').map((p) => p.page),
  };
}
