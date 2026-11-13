import { notFound } from 'next/navigation';
import { PreLessonView } from '@/components/PreLessonView';
import { getLearningEngine } from '@/lib/learning/engine';

export async function generateStaticParams() {
  const courses = await getLearningEngine().listCourses();
  return courses.flatMap((c) => c.sectionIds.map((sectionId) => ({ courseId: c.id, sectionId })));
}

export default async function PreLessonPage({
  params,
}: {
  params: Promise<{ courseId: string; sectionId: string }>;
}) {
  const { courseId, sectionId } = await params;
  const found = await getLearningEngine().getSection(courseId, sectionId);
  if (!found) notFound();
  return <PreLessonView course={found.course} section={found.section} index={found.index} />;
}
