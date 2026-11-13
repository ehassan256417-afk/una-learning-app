import { CoursesView } from '@/components/CoursesView';
import { getLearningEngine } from '@/lib/learning/engine';

export default async function CoursesPage() {
  const courses = await getLearningEngine().listCourses();
  return <CoursesView courses={courses} />;
}
