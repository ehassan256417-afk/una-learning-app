import { notFound } from 'next/navigation';
import { PathView } from '@/components/PathView';
import { getLearningEngine } from '@/lib/learning/engine';

/** Lets the course pages be pre-rendered (needed for the static GitHub Pages build). */
export async function generateStaticParams() {
  const courses = await getLearningEngine().listCourses();
  return courses.map((c) => ({ courseId: c.id }));
}

export default async function CoursePathPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = await getLearningEngine().getCourse(courseId);
  if (!course) notFound();
  return <PathView course={course} />;
}
