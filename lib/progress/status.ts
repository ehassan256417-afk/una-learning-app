/**
 * Pure helpers for section order and unlocking. Kept free of React so they can
 * be used (and tested) outside the browser; `store.tsx` re-exports them.
 */

export interface SectionResult {
  score: number;
  total: number;
  xp: number;
  /** True for the seeded sample history. */
  demo?: boolean;
}

/** The part of the saved progress these helpers need. */
export interface CompletedState {
  completed: Record<string, SectionResult>;
}

export const sectionKey = (courseId: string, sectionId: string) => `${courseId}/${sectionId}`;

export type SectionStatus = 'done' | 'active' | 'locked';

/** Sections unlock in order: the first unfinished one is active. */
export function sectionStatuses(courseId: string, sectionIds: string[], state: CompletedState): SectionStatus[] {
  let activeGiven = false;
  return sectionIds.map((id) => {
    if (state.completed[sectionKey(courseId, id)]) return 'done';
    if (!activeGiven) {
      activeGiven = true;
      return 'active';
    }
    return 'locked';
  });
}

export function courseProgress(courseId: string, sectionIds: string[], state: CompletedState) {
  const done = sectionIds.filter((id) => state.completed[sectionKey(courseId, id)]).length;
  const total = sectionIds.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
