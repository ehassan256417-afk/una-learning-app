import type { CourseSummary } from '@/lib/learning/types';
import { courseProgress, levelFor, type ProgressState } from './store';

export type BadgeIcon = 'book' | 'flame' | 'trophy' | 'layers' | 'star' | 'target';

export interface Badge {
  id: string;
  label: string;
  hint: string;
  icon: BadgeIcon;
  earned: boolean;
}

/** Badges are derived from progress, never stored. */
export function computeBadges(state: ProgressState, courses: CourseSummary[]): Badge[] {
  const results = Object.values(state.completed);
  return [
    { id: 'first-lesson', label: 'First Lesson', hint: 'Finish any section.', icon: 'book', earned: results.length > 0 },
    { id: 'streak-7', label: '7-Day Streak', hint: 'Study 7 days in a row.', icon: 'flame', earned: state.streak >= 7 },
    {
      id: 'course-master',
      label: 'Course Master',
      hint: 'Finish every section of a course.',
      icon: 'trophy',
      earned: courses.some((c) => courseProgress(c.id, c.sectionIds, state).pct === 100),
    },
    { id: 'pdf-explorer', label: 'PDF Explorer', hint: 'Choose a course PDF on the Upload screen.', icon: 'layers', earned: state.pdfSelected },
    { id: 'level-4', label: 'Level 4 Achiever', hint: 'Reach level 4.', icon: 'star', earned: levelFor(state.xp).level >= 4 },
    {
      id: 'perfect-quiz',
      label: 'Perfect Quiz',
      hint: 'Answer every question in a section correctly.',
      icon: 'target',
      earned: results.some((r) => !r.demo && r.total > 0 && r.score === r.total),
    },
  ];
}
