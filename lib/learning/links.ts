import type { Provenance } from './types.ts';

/**
 * URL helpers. Demo courses have pre-rendered pages under /courses/…;
 * courses generated from a PDF only exist in the browser, so they are opened
 * through the single static /my page using query parameters. That keeps the
 * site fully static (GitHub Pages) while supporting any number of PDFs.
 */

interface CourseRef {
  id: string;
  provenance: Provenance;
}

export const isGeneratedCourse = (course: CourseRef) => course.provenance.kind === 'pdf';

const q = encodeURIComponent;

export const coursePath = (course: CourseRef) =>
  isGeneratedCourse(course) ? `/my?c=${q(course.id)}` : `/courses/${course.id}`;

export const sectionPath = (course: CourseRef, sectionId: string) =>
  isGeneratedCourse(course) ? `/my?c=${q(course.id)}&s=${q(sectionId)}` : `/courses/${course.id}/${sectionId}`;

export const lessonPath = (course: CourseRef, sectionId: string) =>
  isGeneratedCourse(course)
    ? `/my?c=${q(course.id)}&s=${q(sectionId)}&v=lesson`
    : `/courses/${course.id}/${sectionId}/lesson`;
