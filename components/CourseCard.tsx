'use client';

import { CheckCircle2, ChevronRight, FileText } from 'lucide-react';
import Link from 'next/link';
import type { CourseSummary } from '@/lib/learning/types';
import { isDemo } from '@/lib/learning/types';
import { courseProgress, useProgress } from '@/lib/progress/store';
import { DemoTag, ProgressBar } from './ui';

export function CourseCard({ course }: { course: CourseSummary }) {
  const { state } = useProgress();
  const { pct, done, total } = courseProgress(course.id, course.sectionIds, state);
  const complete = pct === 100;
  return (
    <Link href={`/courses/${course.id}`} className="coursecard">
      <span className={`pdfico pdfico-${course.accent}`} aria-hidden="true">
        <FileText size={22} />
        <b>PDF</b>
      </span>
      <span className="coursecard-body">
        <span className="coursecard-title">
          <b>
            {course.code} – {course.title}
          </b>
          {isDemo(course.provenance) && <DemoTag />}
        </span>
        <small>
          {course.unitLabel} • {course.pages} pages • {done}/{total} sections
        </small>
        <span className="coursecard-progress">
          <ProgressBar value={pct} tone={complete ? 'green' : 'purple'} label={`${course.code} progress`} />
          <b>{pct}%</b>
          {complete && <CheckCircle2 size={18} className="ok" aria-label="Completed" />}
        </span>
      </span>
      <ChevronRight size={22} className="chev" aria-hidden="true" />
    </Link>
  );
}
