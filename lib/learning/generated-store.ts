'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, currentUserId, onSessionChange } from '../account/client';
import type { CourseIndexEntry } from '../account/contracts';
import { syncCourses, type SyncMeta } from '../account/course-sync';
import { DEMO_COURSES } from './demo-data';
import { summarizeCourse } from './engine';
import type { Course, CourseSummary } from './types';

/**
 * Lessons generated from the student's files.
 *
 * They are kept in this browser, so reopening a course never triggers another
 * AI request and the app works offline. When the student is signed in, the
 * same courses are saved to their account (see `course-sync.ts`) and follow
 * them to any device. Each account has its own storage key, so two students
 * who share a computer never see each other's courses.
 */

const KEY = 'una-learning:pdf-courses:v1';
const META_KEY = 'una-learning:course-sync:v1';
/** A browser gives a site about 5 MB; beyond that the oldest saved course is dropped from this device. */
const MAX_COURSES = 20;
const EMPTY: Course[] = [];

let cache: Course[] | null = null;
let cacheScope = '';
const listeners = new Set<() => void>();

const scoped = (key: string, userId = currentUserId()) => (userId ? `${key}:${userId}` : key);

function isCourse(value: unknown): value is Course {
  const c = value as Course;
  return !!c && typeof c.id === 'string' && Array.isArray(c.sections) && c.provenance?.kind === 'pdf';
}

function read(): Course[] {
  const scope = currentUserId();
  if (cache && cacheScope === scope) return cache;
  cacheScope = scope;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(scoped(KEY)) ?? '[]');
    cache = Array.isArray(parsed) ? parsed.filter(isCourse) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: Course[]): boolean {
  let list = next.slice(0, MAX_COURSES);
  // If storage is full, drop the oldest saved course and try again.
  for (;;) {
    try {
      window.localStorage.setItem(scoped(KEY), JSON.stringify(list));
      cache = list;
      cacheScope = currentUserId();
      listeners.forEach((fn) => fn());
      return true;
    } catch {
      if (list.length <= 1) return false;
      list = list.slice(0, -1);
    }
  }
}

/* ---------- saving to the account ---------- */

function readMeta(): SyncMeta {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(scoped(META_KEY)) ?? '{}') as SyncMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    window.localStorage.setItem(scoped(META_KEY), JSON.stringify(meta));
  } catch {
    /* ignore: the next sync works the differences out again */
  }
}

export type CourseSyncState = { status: 'idle' | 'syncing' | 'saved' | 'offline' | 'problem'; message?: string };
let syncState: CourseSyncState = { status: 'idle' };
const syncListeners = new Set<() => void>();
const setSyncState = (next: CourseSyncState) => {
  syncState = next;
  syncListeners.forEach((fn) => fn());
};

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Brings this browser and the account in step. Does nothing when nobody is signed in. */
export function syncCoursesNow(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  setSyncState({ status: 'syncing' });
  // A sync belongs to the account that started it; if someone else signs in meanwhile, it stops touching storage.
  const mine = () => currentUserId() === userId;
  const guard = <T>(value: T): T => {
    if (!mine()) throw new Error('account changed');
    return value;
  };
  running = syncCourses({
    listRemote: async () => (await api<{ courses: CourseIndexEntry[] }>('/api/me/courses')).courses,
    getRemote: (id) => api<{ updatedAt: number; course: Course }>(`/api/me/courses/${encodeURIComponent(id)}`),
    putRemote: (course) => api<{ updatedAt: number }>(`/api/me/courses/${encodeURIComponent(course.id)}`, { method: 'PUT', body: { course } }),
    deleteRemote: async (id) => {
      await api(`/api/me/courses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    readLocal: () => guard(read()),
    writeLocal: (courses) => {
      guard(null);
      write(courses);
    },
    readMeta: () => guard(readMeta()),
    writeMeta: (meta) => {
      guard(null);
      writeMeta(meta);
    },
  })
    .then((outcome) => setSyncState(outcome.problems.length ? { status: 'problem', message: outcome.problems[0] } : { status: 'saved' }))
    .catch((err: unknown) => {
      const code = (err as { code?: string } | null)?.code;
      setSyncState(code === 'network' ? { status: 'offline', message: 'Changes will be saved to your account when you are back online.' } : { status: 'idle' });
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void syncCoursesNow();
      }
    });
  return running;
}

function scheduleSync() {
  if (!currentUserId()) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncCoursesNow(), 800);
}

/** Uploads anything still waiting, for use just before signing out. */
export async function flushCourses(): Promise<void> {
  clearTimeout(timer);
  await syncCoursesNow();
}

/** Saves (or replaces) a generated course. Returns false if the browser refused to store it. */
export function saveGeneratedCourse(course: Course): boolean {
  const ok = write([course, ...read().filter((c) => c.id !== course.id)]);
  if (ok && currentUserId()) {
    const meta = readMeta();
    meta[course.id] = { updatedAt: meta[course.id]?.updatedAt ?? 0, dirty: true };
    writeMeta(meta);
    scheduleSync();
  }
  return ok;
}

export function deleteGeneratedCourse(id: string): void {
  write(read().filter((c) => c.id !== id));
  if (currentUserId()) {
    const meta = readMeta();
    // A course that never reached the account needs no delete there.
    if (meta[id] && meta[id].updatedAt > 0) meta[id] = { updatedAt: meta[id].updatedAt, deleted: true };
    else delete meta[id];
    writeMeta(meta);
    scheduleSync();
  }
}

/**
 * Moves courses made on this device before signing in into the account that
 * has just been created here. They are moved, not copied, so the next person
 * to use this browser does not find them.
 */
export function adoptDeviceCourses(userId: string): void {
  try {
    const device = window.localStorage.getItem(KEY);
    if (!device || window.localStorage.getItem(scoped(KEY, userId))) return;
    window.localStorage.setItem(scoped(KEY, userId), device);
    window.localStorage.removeItem(KEY);
    cache = null;
    listeners.forEach((fn) => fn());
  } catch {
    /* ignore */
  }
}

export const findGeneratedByDocument = (documentId: string): Course | undefined =>
  read().find((c) => c.provenance.kind === 'pdf' && c.provenance.documentId === documentId);

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== scoped(KEY)) return;
    cache = null;
    fn();
  };
  // Signing in or out switches to another account's courses.
  const offSession = onSessionChange(() => {
    cache = null;
    fn();
  });
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    offSession();
    window.removeEventListener('storage', onStorage);
  };
}

/** `ready` is false during server rendering and the first client paint. */
export function useGeneratedCourses(): { courses: Course[]; ready: boolean } {
  const courses = useSyncExternalStore(subscribe, read, () => EMPTY);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return { courses, ready };
}

export function useCourseSyncState(): CourseSyncState {
  return useSyncExternalStore(
    (fn) => {
      syncListeners.add(fn);
      return () => syncListeners.delete(fn);
    },
    () => syncState,
    () => syncState,
  );
}

/** The student's own courses first, then the sample courses (when the site shows them). */
export function useAllCourses(demo: CourseSummary[]): { all: CourseSummary[]; generated: CourseSummary[] } {
  const { courses } = useGeneratedCourses();
  return useMemo(() => {
    const generated = courses.map(summarizeCourse);
    return { all: [...generated, ...demo], generated };
  }, [courses, demo]);
}

/** Every course with its full lessons (the student's first), for review and mastery screens. */
export function useStudyCourses(includeSamples = true): Course[] {
  const { courses } = useGeneratedCourses();
  return useMemo(() => (includeSamples ? [...courses, ...DEMO_COURSES] : courses), [courses, includeSamples]);
}
