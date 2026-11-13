'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEMO_COMPLETED_SECTIONS, DEMO_STARTING_STREAK, DEMO_STARTING_XP } from '@/lib/learning/demo-data';

/**
 * Local-only progress. Nothing leaves the browser: state lives in
 * localStorage and starts from clearly labeled demo values. When accounts
 * exist, replace the load/save pair with API calls; the hook API can stay.
 */

import type { SectionResult } from './status';

export { courseProgress, sectionKey, sectionStatuses } from './status';
export type { SectionResult, SectionStatus } from './status';

export interface ProgressState {
  version: 1;
  name: string;
  xp: number;
  streak: number;
  lastStudyDay: string | null;
  todayXp: number;
  completed: Record<string, SectionResult>;
  pdfSelected: boolean;
}

const STORAGE_KEY = 'una-learning:progress:v1';
export const XP_PER_LEVEL = 250;

const LEVEL_TITLES = ['Cub', 'Explorer', 'Pride Member', 'Lion Scholar', 'Pride Leader', 'Campus Legend'];

export function levelFor(xp: number) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const into = xp % XP_PER_LEVEL;
  return {
    level,
    title: LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1],
    into,
    toNext: XP_PER_LEVEL - into,
    pct: Math.round((into / XP_PER_LEVEL) * 100),
  };
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ME';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function seedState(): ProgressState {
  return {
    version: 1,
    name: 'Hassan',
    xp: DEMO_STARTING_XP,
    streak: DEMO_STARTING_STREAK,
    lastStudyDay: null,
    todayXp: 0,
    completed: Object.fromEntries(
      DEMO_COMPLETED_SECTIONS.map((k) => [k, { score: 3, total: 3, xp: 0, demo: true } satisfies SectionResult]),
    ),
    pdfSelected: false,
  };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function load(): ProgressState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProgressState;
    if (parsed?.version !== 1 || typeof parsed.xp !== 'number' || typeof parsed.completed !== 'object') return null;
    // A new day resets the "today" counter.
    if (parsed.lastStudyDay !== dayKey(new Date())) parsed.todayXp = 0;
    return parsed;
  } catch {
    return null;
  }
}

interface ProgressApi {
  state: ProgressState;
  /** False until localStorage has been read (first client render). */
  ready: boolean;
  /** Records a finished section. Returns the XP actually awarded (0 on replays). */
  completeSection(key: string, result: { score: number; total: number; xp: number }): number;
  setName(name: string): void;
  markPdfSelected(): void;
  resetDemo(): void;
}

const ProgressContext = createContext<ProgressApi | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProgressState>(seedState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = load();
    if (stored) setState(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable (private mode); progress then lasts for the session only.
    }
  }, [state, ready]);

  const completeSection = useCallback<ProgressApi['completeSection']>(
    (key, result) => {
      const firstTime = !state.completed[key];
      const awarded = firstTime ? result.xp : 0;
      setState((prev) => {
        const today = dayKey(new Date());
        const yesterday = dayKey(new Date(Date.now() - 86_400_000));
        let streak = prev.streak;
        if (prev.lastStudyDay !== today) {
          streak = prev.lastStudyDay === null || prev.lastStudyDay === yesterday ? prev.streak + 1 : 1;
        }
        const previous = prev.completed[key];
        const best =
          previous && !previous.demo && previous.score > result.score
            ? previous
            : { score: result.score, total: result.total, xp: previous ? previous.xp : result.xp };
        return {
          ...prev,
          xp: prev.xp + (prev.completed[key] ? 0 : result.xp),
          todayXp: (prev.lastStudyDay === today ? prev.todayXp : 0) + (prev.completed[key] ? 0 : result.xp),
          streak,
          lastStudyDay: today,
          completed: { ...prev.completed, [key]: best },
        };
      });
      return awarded;
    },
    [state.completed],
  );

  const api = useMemo<ProgressApi>(
    () => ({
      state,
      ready,
      completeSection,
      setName: (name) => setState((p) => ({ ...p, name })),
      markPdfSelected: () => setState((p) => (p.pdfSelected ? p : { ...p, pdfSelected: true })),
      resetDemo: () => setState(seedState()),
    }),
    [state, ready, completeSection],
  );

  return <ProgressContext.Provider value={api}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressApi {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error('useProgress must be used inside <ProgressProvider>');
  return ctx;
}
