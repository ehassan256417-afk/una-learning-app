import { DEMO_COURSES } from './demo-data';
import type { Course, CourseSummary, Section } from './types';

/**
 * Read access to the built-in demo courses, used by the pre-rendered pages.
 *
 * Courses generated from a student's PDF do not come through here: they are
 * created by the lesson backend (see `server/`), saved in the browser
 * (`generated-store.ts`) and opened through the static `/my` page.
 */
export interface LearningEngine {
  readonly id: 'demo';
  listCourses(): Promise<CourseSummary[]>;
  getCourse(courseId: string): Promise<Course | null>;
  getSection(courseId: string, sectionId: string): Promise<{ course: Course; section: Section; index: number } | null>;
}

export const summarizeCourse = (c: Course): CourseSummary => ({
  id: c.id,
  code: c.code,
  title: c.title,
  unitLabel: c.unitLabel,
  unitTitle: c.unitTitle,
  pages: c.pages,
  accent: c.accent,
  sectionIds: c.sections.map((s) => s.id),
  provenance: c.provenance,
  generation: c.generation,
});

export const demoEngine: LearningEngine = {
  id: 'demo',
  async listCourses() {
    return DEMO_COURSES.map(summarizeCourse);
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
};

export function getLearningEngine(): LearningEngine {
  return demoEngine;
}
