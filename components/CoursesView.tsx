'use client';

import { CloudUpload } from 'lucide-react';
import Link from 'next/link';
import { useAllCourses } from '@/lib/learning/generated-store';
import type { CourseSummary } from '@/lib/learning/types';
import { AppHeader } from './AppHeader';
import { CourseCard } from './CourseCard';
import { DemoTag } from './ui';

export function CoursesView({ courses }: { courses: CourseSummary[] }) {
  const { generated } = useAllCourses(courses);
  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="hero-title">
          <h1>My Courses</h1>
          <p>Pick a course to open its learning path.</p>
        </div>
      </section>
      <div className="pad pad-top">
        {generated.length > 0 && (
          <>
            <h2 className="listhead">From your PDFs</h2>
            <div className="stack">
              {generated.map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
            <h2 className="listhead">Sample courses</h2>
          </>
        )}
        <p className="demo-line">
          <DemoTag /> These {courses.length} courses are sample content, not built from real PDFs.
        </p>
        <div className="stack">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
        <Link href="/upload" className="uploadcta">
          <span className="uploadcta-ico">
            <CloudUpload size={24} />
          </span>
          <span>
            <b>Add a course from a PDF</b>
            <small>Upload a chapter and turn it into lessons with page references.</small>
          </span>
        </Link>
      </div>
    </main>
  );
}
