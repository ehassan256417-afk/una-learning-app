import { Suspense } from 'react';
import { GeneratedRoute } from '@/components/GeneratedRoute';

/**
 * One static page for every course generated from a PDF:
 *   /my?c=<course>                    learning path
 *   /my?c=<course>&s=<section>        pre-lesson
 *   /my?c=<course>&s=<section>&v=lesson   lesson player
 * The course itself is read from the browser, so no server rendering is needed.
 */
export default function MyCoursePage() {
  return (
    <Suspense fallback={null}>
      <GeneratedRoute />
    </Suspense>
  );
}
