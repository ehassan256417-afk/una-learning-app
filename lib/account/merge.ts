import type { ReviewMap } from '../progress/mastery.ts';
import type { SectionResult } from '../progress/status.ts';

/**
 * Joins two copies of one student's progress, for example this device's copy
 * and the copy saved in the account by another device.
 *
 * Nothing a student did is ever dropped: finished lessons and review records
 * from both copies are kept, and for anything present in both the copy with
 * more practice wins. XP takes the larger total, so XP earned on two devices
 * while both were offline is not added twice (and may undercount a little).
 *
 * Pure function with no browser dependencies, so it is tested in Node.
 */

export interface ProgressData {
  version: 1;
  name: string;
  xp: number;
  streak: number;
  lastStudyDay: string | null;
  todayXp: number;
  completed: Record<string, SectionResult>;
  pdfSelected: boolean;
  review: ReviewMap;
}

/** "2026-11-4" style day keys (not zero padded) as a sortable number. */
function dayNumber(key: string | null): number {
  if (!key) return 0;
  const [y, m, d] = key.split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? y * 10_000 + m * 100 + d : 0;
}

function betterResult(a: SectionResult | undefined, b: SectionResult | undefined): SectionResult {
  if (!a) return b!;
  if (!b) return a;
  // Real work beats seeded sample history; then the higher score.
  if (!!a.demo !== !!b.demo) return a.demo ? b : a;
  const best = b.score > a.score ? b : a;
  return { ...best, xp: Math.max(a.xp, b.xp) };
}

export function mergeProgress(local: ProgressData, remote: ProgressData): ProgressData {
  const localDay = dayNumber(local.lastStudyDay);
  const remoteDay = dayNumber(remote.lastStudyDay);
  const latest = remoteDay > localDay ? remote : local;

  const completed: Record<string, SectionResult> = {};
  for (const key of new Set([...Object.keys(local.completed), ...Object.keys(remote.completed)])) {
    completed[key] = betterResult(local.completed[key], remote.completed[key]);
  }

  const review: ReviewMap = {};
  for (const key of new Set([...Object.keys(local.review), ...Object.keys(remote.review)])) {
    const a = local.review[key];
    const b = remote.review[key];
    review[key] = !a ? b : !b ? a : b.seen > a.seen ? b : a;
  }

  return {
    version: 1,
    name: local.name || remote.name,
    xp: Math.max(local.xp, remote.xp),
    streak: localDay === remoteDay ? Math.max(local.streak, remote.streak) : latest.streak,
    lastStudyDay: latest.lastStudyDay,
    todayXp: localDay === remoteDay ? Math.max(local.todayXp, remote.todayXp) : latest.todayXp,
    completed,
    pdfSelected: local.pdfSelected || remote.pdfSelected,
    review,
  };
}

/** True when the two copies hold the same data, whatever the key order. */
export function sameProgress(a: ProgressData, b: ProgressData): boolean {
  const norm = (p: ProgressData) =>
    JSON.stringify([
      p.name,
      p.xp,
      p.streak,
      p.lastStudyDay,
      p.todayXp,
      p.pdfSelected,
      Object.keys(p.completed)
        .sort()
        .map((k) => [k, p.completed[k].score, p.completed[k].total, p.completed[k].xp, !!p.completed[k].demo]),
      Object.keys(p.review)
        .sort()
        .map((k) => [k, p.review[k].box, p.review[k].due, p.review[k].seen, p.review[k].lapses]),
    ]);
  return norm(a) === norm(b);
}

/** Whether a copy holds anything the student actually did. */
export const hasRealProgress = (p: ProgressData): boolean =>
  p.xp > 0 || Object.keys(p.review).length > 0 || Object.values(p.completed).some((r) => !r.demo);
