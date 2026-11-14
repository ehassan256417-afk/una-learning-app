'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorPayload, registerFlusher } from '@/lib/account/client';
import type { ProgressEnvelope } from '@/lib/account/contracts';
import { hasRealProgress, mergeProgress, sameProgress, type ProgressData } from '@/lib/account/merge';
import { ADOPT_KEY, useSession } from '@/lib/account/session';

/**
 * A student's progress: XP, streak, finished lessons and spaced-review records.
 *
 * Signed in, it is saved to the account and merged with what other devices
 * saved, with a copy cached in this browser so the app opens instantly and
 * keeps working offline. Without a backend (the static demo build) it lives
 * in this browser only. Every account has its own storage key.
 */

import { applyGrades, dayIndex, type GradeEntry } from './mastery';

export { courseProgress, sectionKey, sectionStatuses } from './status';
export type { SectionResult, SectionStatus } from './status';

export type ProgressState = ProgressData;

const STORAGE_KEY = 'una-learning:progress:v1';
export const XP_PER_LEVEL = 250;
/** Earlier versions started every browser with sample history; it is removed when found. */
const OLD_SEED_XP = 850;
const OLD_SEED_STREAK = 7;
const PUSH_DELAY_MS = 1200;

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

/** A new student starts from zero: no sample history, nobody else's name. */
function freshState(name = ''): ProgressState {
  return { version: 1, name, xp: 0, streak: 0, lastStudyDay: null, todayXp: 0, completed: {}, pdfSelected: false, review: {} };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Counts today as a study day (which moves the streak) and adds XP. */
function studied(prev: ProgressState, xp: number): Pick<ProgressState, 'xp' | 'todayXp' | 'streak' | 'lastStudyDay'> {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  let streak = prev.streak;
  if (prev.lastStudyDay !== today) {
    streak = prev.lastStudyDay === null || prev.lastStudyDay === yesterday ? prev.streak + 1 : 1;
  }
  return {
    xp: prev.xp + xp,
    todayXp: (prev.lastStudyDay === today ? prev.todayXp : 0) + xp,
    streak,
    lastStudyDay: today,
  };
}

/** Takes the old sample history out of a saved copy, keeping everything the student really did. */
function withoutSeed(p: ProgressState): ProgressState {
  const seeded = Object.values(p.completed).some((r) => r.demo);
  if (!seeded) return p;
  const completed = Object.fromEntries(Object.entries(p.completed).filter(([, r]) => !r.demo));
  return {
    ...p,
    name: p.name === 'Hassan' && !hasRealProgress({ ...p, xp: 0 }) ? '' : p.name,
    xp: Math.max(0, p.xp - OLD_SEED_XP),
    streak: p.lastStudyDay ? Math.max(1, p.streak - OLD_SEED_STREAK) : 0,
    completed,
  };
}

const storageKey = (userId: string) => (userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY);

function load(key: string): ProgressState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProgressState;
    if (parsed?.version !== 1 || typeof parsed.xp !== 'number' || typeof parsed.completed !== 'object') return null;
    // A new day resets the "today" counter.
    if (parsed.lastStudyDay !== dayKey(new Date())) parsed.todayXp = 0;
    // Progress saved before spaced review existed has no review records yet.
    if (!parsed.review || typeof parsed.review !== 'object' || Array.isArray(parsed.review)) parsed.review = {};
    return withoutSeed(parsed);
  } catch {
    return null;
  }
}

function save(key: string, state: ProgressState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode); progress then lasts for the session only.
  }
}

/** Progress made in this browser before an account existed, taken out of device storage for the new account. */
function takeDeviceProgress(userId: string): ProgressState | null {
  try {
    if (window.sessionStorage.getItem(ADOPT_KEY) !== userId) return null;
    window.sessionStorage.removeItem(ADOPT_KEY);
    const device = load(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY);
    return device && hasRealProgress(device) ? device : null;
  } catch {
    return null;
  }
}

export type ProgressSync = 'local' | 'saved' | 'saving' | 'offline';

interface ProgressApi {
  state: ProgressState;
  /** False until saved progress has been read (first client render, or first answer from the account). */
  ready: boolean;
  /** Where the latest change is: only on this device, saved to the account, on its way, or waiting for a connection. */
  sync: ProgressSync;
  /** Records a finished section. Returns the XP actually awarded (0 on replays). */
  completeSection(key: string, result: { score: number; total: number; xp: number }): number;
  /** Records practice attempts for spaced review. Counts as studying today; `xp` is added as given. */
  gradeItems(grades: GradeEntry[], xp?: number): void;
  setName(name: string): void;
  markPdfSelected(): void;
  /** Clears all progress. In an account this is saved like any other change. */
  resetProgress(): void;
}

const ProgressContext = createContext<ProgressApi | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const { mode, user } = useSession();
  const userId = mode === 'user' && user ? user.id : '';
  const userName = user?.name ?? '';
  const [state, setState] = useState<ProgressState>(freshState);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<ProgressSync>('local');

  /** The account this state belongs to; null until something has been loaded. */
  const owner = useRef<string | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const rev = useRef(0);
  /** The copy the account is known to hold. */
  const remote = useRef<ProgressState | null>(null);
  const pushing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A reset must replace the account's copy instead of being merged back with it. */
  const replace = useRef(false);

  const push = useCallback(async (): Promise<void> => {
    const id = owner.current;
    if (!id || pushing.current) return;
    const snapshot = latest.current;
    if (remote.current && sameProgress(snapshot, remote.current)) {
      setSync('saved');
      return;
    }
    pushing.current = true;
    setSync('saving');
    try {
      const saved = await api<{ rev: number }>('/api/me/progress', { method: 'PUT', body: { baseRev: rev.current, state: snapshot } });
      if (owner.current !== id) return;
      rev.current = saved.rev;
      remote.current = snapshot;
      replace.current = false;
      setSync('saved');
    } catch (err) {
      if (owner.current !== id) return;
      const newer = errorPayload<ProgressEnvelope>(err);
      if ((err as { status?: number }).status === 409 && newer && newer.state) {
        // Another device saved first: join the two copies and save the result.
        rev.current = newer.rev;
        remote.current = newer.state as ProgressState;
        if (!replace.current) setState((mine) => mergeProgress(mine, newer.state as ProgressState));
      } else {
        setSync('offline');
      }
    } finally {
      pushing.current = false;
      // Changes made while the request was in flight go out next.
      if (owner.current === id && remote.current && !sameProgress(latest.current, remote.current)) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void push(), PUSH_DELAY_MS);
      }
    }
  }, []);

  /** Reads the account's copy and joins it with this browser's. */
  const pull = useCallback(
    async (id: string, base: ProgressState | null, name: string): Promise<void> => {
      try {
        const envelope = await api<ProgressEnvelope>('/api/me/progress');
        if (owner.current !== id) return;
        rev.current = envelope.rev;
        if (envelope.state) {
          remote.current = envelope.state as ProgressState;
          setState((mine) => ({ ...mergeProgress(base ? mine : (envelope.state as ProgressState), envelope.state as ProgressState), name }));
        } else {
          remote.current = null;
          const device = base ? null : takeDeviceProgress(id);
          if (device) setState({ ...device, name });
        }
      } catch {
        if (owner.current === id) setSync('offline');
      }
    },
    [],
  );

  // Load whenever the account changes: sign-in, sign-out, or the first paint.
  useEffect(() => {
    if (mode === 'loading') return;
    clearTimeout(timer.current);
    rev.current = 0;
    remote.current = null;
    replace.current = false;
    const cached = load(storageKey(userId));
    owner.current = userId;
    if (!userId) {
      setState(mode === 'local' ? (cached ?? freshState()) : freshState());
      setSync('local');
      setReady(true);
      return;
    }
    setState(cached ? { ...cached, name: userName } : freshState(userName));
    // With a cached copy the app is usable at once; otherwise wait for the account's answer.
    setReady(!!cached);
    setSync('saving');
    void pull(userId, cached, userName).finally(() => {
      if (owner.current === userId) setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, userId]);

  // The display name follows the account.
  useEffect(() => {
    if (userId && owner.current === userId) setState((p) => (p.name === userName ? p : { ...p, name: userName }));
  }, [userId, userName]);

  // Every change is cached here at once and sent to the account shortly after.
  // `armed` names the account whose data `state` currently holds. It is set by the effect below, which
  // runs after this one, so on the render where the account changes (and `state` still belongs to the
  // previous account) nothing is written under the new account's key.
  const armed = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || armed.current !== userId || owner.current !== userId) return;
    // A visitor who is not signed in has no progress to keep.
    if (!userId && mode !== 'local') return;
    save(storageKey(userId), state);
    if (!userId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void push(), PUSH_DELAY_MS);
  }, [state, ready, userId, mode, push]);
  useEffect(() => {
    armed.current = mode === 'loading' ? null : userId;
  }, [mode, userId]);

  useEffect(() => {
    if (!userId) return;
    const flush = async () => {
      clearTimeout(timer.current);
      await push();
    };
    const offFlush = registerFlusher(flush);
    const retry = () => void push();
    // Returning to the tab picks up what another device saved in the meantime.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pull(userId, latest.current, userName);
      else void flush();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offFlush();
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, userName, push, pull]);

  const completeSection = useCallback<ProgressApi['completeSection']>(
    (key, result) => {
      const firstTime = !state.completed[key];
      const awarded = firstTime ? result.xp : 0;
      setState((prev) => {
        const previous = prev.completed[key];
        const best =
          previous && !previous.demo && previous.score > result.score
            ? previous
            : { score: result.score, total: result.total, xp: previous ? previous.xp : result.xp };
        return {
          ...prev,
          ...studied(prev, previous ? 0 : result.xp),
          completed: { ...prev.completed, [key]: best },
        };
      });
      return awarded;
    },
    [state.completed],
  );

  const gradeItems = useCallback<ProgressApi['gradeItems']>((grades, xp = 0) => {
    if (grades.length === 0) return;
    setState((prev) => ({
      ...prev,
      ...studied(prev, xp),
      review: applyGrades(prev.review, grades, dayIndex(new Date())),
    }));
  }, []);

  const value = useMemo<ProgressApi>(
    () => ({
      state,
      ready,
      sync,
      completeSection,
      gradeItems,
      setName: (name) => setState((p) => ({ ...p, name })),
      markPdfSelected: () => setState((p) => (p.pdfSelected ? p : { ...p, pdfSelected: true })),
      resetProgress: () => {
        replace.current = true;
        // The account's copy is forgotten locally so the empty state is sent instead of being merged away.
        remote.current = null;
        setState((p) => freshState(p.name));
      },
    }),
    [state, ready, sync, completeSection, gradeItems],
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressApi {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error('useProgress must be used inside <ProgressProvider>');
  return ctx;
}
