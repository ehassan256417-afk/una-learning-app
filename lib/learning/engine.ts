import { DEMO_COURSES } from './demo-data';
import type { Course, CourseSummary, Section } from './types';

/**
 * The single seam between the UI and wherever learning content comes from.
 *
 * Pages only ever talk to `getLearningEngine()`. Today that returns the demo
 * engine (static sample data, no network, no AI). The future source-grounded
 * PDF engine implements the same interface, so no screen has to change.
 *
 * Planned PDF pipeline (not implemented):
 *   1. Store the PDF privately and extract text per page.
 *   2. Chunk the text, keeping page numbers with every chunk.
 *   3. Generate sections / notes / questions from retrieved chunks only.
 *   4. Attach `SourceCitation`s and run `validateSectionGrounding`;
 *      drop anything that is not supported by an excerpt.
 */
export interface LearningEngine {
  readonly id: 'demo' | 'pdf';
  listCourses(): Promise<CourseSummary[]>;
  getCourse(courseId: string): Promise<Course | null>;
  getSection(courseId: string, sectionId: string): Promise<{ course: Course; section: Section; index: number } | null>;
  /** Turn an uploaded PDF into a course. */
  ingestPdf(file: { name: string; size: number }): Promise<IngestResult>;
}

export type IngestResult =
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; courseId: string };

const summarize = (c: Course): CourseSummary => ({
  id: c.id,
  code: c.code,
  title: c.title,
  unitLabel: c.unitLabel,
  unitTitle: c.unitTitle,
  pages: c.pages,
  accent: c.accent,
  sectionIds: c.sections.map((s) => s.id),
  provenance: c.provenance,
});

export const demoEngine: LearningEngine = {
  id: 'demo',
  async listCourses() {
    return DEMO_COURSES.map(summarize);
  },
  async getCourse(courseId) {
    return DEMO_COURSES.find((c) => c.id === courseId) ?? null;
  },
  async getSection(courseId, sectionId) {
    const course = DEMO_COURSES.find((c) => c.id === courseId);
    if (!course) return null;
    const index = course.sections.findIndex((s) => s.id === sectionId);
    if (index < 0) return null;
    return { course, section: course.sections[index], index };
  },
  async ingestPdf() {
    return {
      status: 'unavailable',
      message: 'PDF processing is not built yet. Your file stayed on this device and was not uploaded.',
    };
  },
};

/** Swap the implementation here when the PDF engine exists. */
export function getLearningEngine(): LearningEngine {
  return demoEngine;
}
