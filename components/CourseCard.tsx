'use client';

import { CheckCircle2, ChevronRight, FileText } from 'lucide-react';
import Link from 'next/link';
import { coursePath, isGeneratedCourse } from '@/lib/learning/links';
import type { CourseSummary } from '@/lib/learning/types';
import { sourceName } from '@/lib/learning/types';
import { courseProgress, useProgress } from '@/lib/progress/store';
import { DemoTag, ProgressBar } from './ui';

export function CourseCard({ course }: { course: CourseSummary }) {
  const { state } = useProgress();
  const { pct, done, total } = courseProgress(course.id, course.sectionIds, state);
  const complete = pct === 100;
  const fromPdf = isGeneratedCourse(course);
  return (
    <Link href={coursePath(course)} className="coursecard">
      <span className={`pdfico pdfico-${course.accent}`} aria-hidden="true">
        <FileText size={22} />
        <b>{course.sourceKind === 'pptx' ? 'PPT' : 'PDF'}</b>
      </span>
      <span className="coursecard-body">
        <span className="coursecard-title">
          <b>{fromPdf ? course.title : `${course.code} – ${course.title}`}</b>
          {fromPdf ? <span className="demotag pdftag">Your {sourceName(course)}</span> : <DemoTag />}
        </span>
        <small>
          {fromPdf ? course.unitTitle : course.unitLabel} • {course.pages} pages • {done}/{total} sections
        </small>
        <span className="coursecard-progress">
          <ProgressBar value={pct} tone={complete ? 'green' : 'purple'} label={`${course.title} progress`} />
          <b>{pct}%</b>
          {complete && <CheckCircle2 size={18} className="ok" aria-label="Completed" />}
        </span>
      </span>
      <ChevronRight size={22} className="chev" aria-hidden="true" />
    </Link>
  );
}
