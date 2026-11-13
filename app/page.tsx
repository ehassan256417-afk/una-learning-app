import { DashboardView } from '@/components/DashboardView';
import { getLearningEngine } from '@/lib/learning/engine';

export default async function HomePage() {
  const courses = await getLearningEngine().listCourses();
  return <DashboardView courses={courses} />;
}
