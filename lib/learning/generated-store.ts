'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { summarizeCourse } from './engine';
import type { Course, CourseSummary } from './types';

/**
 * Lessons generated from the student's PDFs, kept in this browser only.
 * Saving them here means reopening a course never triggers another AI request,
 * and nothing about the student's documents is stored on a server or in GitHub.
 */

const KEY = 'una-learning:pdf-courses:v1';
const MAX_COURSES = 8;
const EMPTY: Course[] = [];

let cache: Course[] | null = null;
const listeners = new Set<() => void>();

function isCourse(value: unknown): value is Course {
  const c = value as Course;
  return !!c && typeof c.id === 'string' && Array.isArray(c.sections) && c.provenance?.kind === 'pdf';
}

function read(): Course[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
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
      window.localStorage.setItem(KEY, JSON.stringify(list));
      cache = list;
      listeners.forEach((fn) => fn());
      return true;
    } catch {
      if (list.length <= 1) return false;
      list = list.slice(0, -1);
    }
  }
}

/** Saves (or replaces) a generated course. Returns false if the browser refused to store it. */
export function saveGeneratedCourse(course: Course): boolean {
  return write([course, ...read().filter((c) => c.id !== course.id)]);
}

export function deleteGeneratedCourse(id: string): void {
  write(read().filter((c) => c.id !== id));
}

export const findGeneratedByDocument = (documentId: string): Course | undefined =>
  read().find((c) => c.provenance.kind === 'pdf' && c.provenance.documentId === documentId);

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
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

/** The student's PDF courses first, then the demo courses. */
export function useAllCourses(demo: CourseSummary[]): { all: CourseSummary[]; generated: CourseSummary[] } {
  const { courses } = useGeneratedCourses();
  return useMemo(() => {
    const generated = courses.map(summarizeCourse);
    return { all: [...generated, ...demo], generated };
  }, [courses, demo]);
}
