'use client';

import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useGeneratedCourses } from '@/lib/learning/generated-store';
import { LessonPlayer } from './LessonPlayer';
import { PathView } from './PathView';
import { PreLessonView } from './PreLessonView';

/** Opens a PDF-generated course in the same screens the demo courses use. */
export function GeneratedRoute() {
  const params = useSearchParams();
  const { courses, ready } = useGeneratedCourses();
  const courseId = params.get('c');
  const sectionId = params.get('s');

  if (!ready) {
    return (
      <main className="screen with-nav">
        <div className="lockedscreen" role="status">
          <span className="spinner" aria-hidden="true" />
          <p>Opening your course…</p>
        </div>
      </main>
    );
  }

  const course = courses.find((c) => c.id === courseId);
  const index = course && sectionId ? course.sections.findIndex((s) => s.id === sectionId) : -1;

  if (!course || (sectionId && index < 0)) {
    return (
      <main className="screen with-nav">
        <div className="lockedscreen">
          <span className="lockedscreen-ico">
            <FileQuestion size={30} />
          </span>
          <h1>Course not found</h1>
          <p>
            Lessons made from a PDF are saved on the device that created them. This one is not saved in this browser.
          </p>
          <Link href="/upload" className="btn btn-gold">
            Upload a PDF
          </Link>
          <Link href="/courses" className="textlink">
            Back to courses
          </Link>
        </div>
      </main>
    );
  }

  if (!sectionId) return <PathView course={course} />;
  const section = course.sections[index];
  // `key` resets lesson state when moving from one section to the next.
  return params.get('v') === 'lesson' ? (
    <LessonPlayer key={section.id} course={course} section={section} index={index} />
  ) : (
    <PreLessonView key={section.id} course={course} section={section} index={index} />
  );
}
