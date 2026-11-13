import { notFound } from 'next/navigation';
import { LessonPlayer } from '@/components/LessonPlayer';
import { getLearningEngine } from '@/lib/learning/engine';

export async function generateStaticParams() {
  const courses = await getLearningEngine().listCourses();
  return courses.flatMap((c) => c.sectionIds.map((sectionId) => ({ courseId: c.id, sectionId })));
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ courseId: string; sectionId: string }>;
}) {
  const { courseId, sectionId } = await params;
  const found = await getLearningEngine().getSection(courseId, sectionId);
  if (!found) notFound();
  return <LessonPlayer course={found.course} section={found.section} index={found.index} />;
}
