import { ProgressView } from '@/components/ProgressView';
import { getLearningEngine } from '@/lib/learning/engine';

export default async function ProgressPage() {
  const courses = await getLearningEngine().listCourses();
  return <ProgressView courses={courses} />;
}
