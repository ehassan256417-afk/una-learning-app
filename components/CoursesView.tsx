'use client';

import { CloudUpload } from 'lucide-react';
import Link from 'next/link';
import type { CourseSummary } from '@/lib/learning/types';
import { AppHeader } from './AppHeader';
import { CourseCard } from './CourseCard';
import { DemoTag } from './ui';

export function CoursesView({ courses }: { courses: CourseSummary[] }) {
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
            <small>Preview the upload flow. Processing is not built yet.</small>
          </span>
        </Link>
      </div>
    </main>
  );
}
