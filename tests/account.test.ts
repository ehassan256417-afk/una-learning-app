import { describe, it } from 'node:test';
import type { CourseIndexEntry } from '../lib/account/contracts.ts';
import { syncCourses, type CourseSyncIo, type SyncMeta } from '../lib/account/course-sync.ts';
import { hasRealProgress, mergeProgress, sameProgress, type ProgressData } from '../lib/account/merge.ts';
import { isStudyRoute, routeName } from '../lib/account/route.ts';
import type { Course } from '../lib/learning/types.ts';
import { expect } from './helpers/expect.ts';

const progress = (over: Partial<ProgressData> = {}): ProgressData => ({
  version: 1,
  name: 'Sam',
  xp: 0,
  streak: 0,
  lastStudyDay: null,
  todayXp: 0,
  completed: {},
  pdfSelected: false,
  review: {},
  ...over,
});

describe('merging progress from two devices', () => {
  it('keeps finished lessons and review records from both', () => {
    const phone = progress({
      xp: 60,
      streak: 2,
      lastStudyDay: '2026-11-14',
      todayXp: 30,
      completed: { 'c/a': { score: 2, total: 3, xp: 30 } },
      review: { 'c/a/q1': { box: 1, due: 20500, seen: 1, lapses: 0 } },
    });
    const laptop = progress({
      xp: 90,
      streak: 1,
      lastStudyDay: '2026-11-9',
      todayXp: 0,
      completed: { 'c/b': { score: 3, total: 3, xp: 40 } },
      review: { 'c/b/q1': { box: 2, due: 20510, seen: 2, lapses: 0 } },
    });
    const merged = mergeProgress(phone, laptop);
    expect(Object.keys(merged.completed).sort()).toEqual(['c/a', 'c/b']);
    expect(Object.keys(merged.review).sort()).toEqual(['c/a/q1', 'c/b/q1']);
    expect(merged.xp).toBe(90);
    // The streak and "today" come from whichever copy studied most recently ("11-14" is after "11-9").
    expect(merged).toMatchObject({ streak: 2, lastStudyDay: '2026-11-14', todayXp: 30 });
  });

  it('prefers the better score and the record with more practice', () => {
    const a = progress({
      completed: { 'c/a': { score: 1, total: 3, xp: 20 } },
      review: { k: { box: 0, due: 10, seen: 4, lapses: 2 } },
    });
    const b = progress({
      completed: { 'c/a': { score: 3, total: 3, xp: 10 } },
      review: { k: { box: 3, due: 30, seen: 2, lapses: 0 } },
    });
    const merged = mergeProgress(a, b);
    expect(merged.completed['c/a']).toEqual({ score: 3, total: 3, xp: 20 });
    expect(merged.review.k.seen).toBe(4);
  });

  it('gives the same result in either order and is stable when repeated', () => {
    const a = progress({ xp: 10, lastStudyDay: '2026-11-13', streak: 3, completed: { x: { score: 1, total: 2, xp: 5 } } });
    const b = progress({ xp: 40, lastStudyDay: '2026-11-14', streak: 4, review: { k: { box: 1, due: 5, seen: 1, lapses: 0 } } });
    const ab = mergeProgress(a, b);
    expect(sameProgress(ab, mergeProgress(b, a))).toBe(true);
    expect(sameProgress(mergeProgress(ab, b), ab)).toBe(true);
    expect(sameProgress(a, b)).toBe(false);
  });

  it('lets real work replace seeded sample history, and knows empty progress', () => {
    const seeded = progress({ completed: { s: { score: 3, total: 3, xp: 0, demo: true } } });
    const real = progress({ completed: { s: { score: 1, total: 3, xp: 20 } } });
    expect(mergeProgress(seeded, real).completed.s).toEqual({ score: 1, total: 3, xp: 20 });
    expect(hasRealProgress(seeded)).toBe(false);
    expect(hasRealProgress(real)).toBe(true);
    expect(hasRealProgress(progress())).toBe(false);
  });
});

describe('route names for page statistics', () => {
  it('keeps the kind of page and drops ids and queries', () => {
    expect(routeName('/', '')).toBe('/');
    expect(routeName('/register/', '')).toBe('/register');
    expect(routeName('/my', '?c=pdf-123abc')).toBe('/my');
    expect(routeName('/my/', '?c=pdf-123abc&s=lesson-2')).toBe('/my/section');
    expect(routeName('/my', '?c=pdf-123abc&s=lesson-2&v=lesson')).toBe('/my/lesson');
    expect(routeName('/courses/cis-344', '')).toBe('/courses/:course');
    expect(routeName('/courses/cis-344/intro', '')).toBe('/courses/:course/:section');
    expect(routeName('/courses/cis-344/intro/lesson', '')).toBe('/courses/:course/:section/lesson');
    expect(routeName('/una-learning-app/upload/', '', '/una-learning-app')).toBe('/upload');
    expect(routeName('/Weird Path<script>', '')).toBe('/other');
  });

  it('counts lessons and review as study', () => {
    expect(isStudyRoute('/my/lesson')).toBe(true);
    expect(isStudyRoute('/courses/:course/:section/lesson')).toBe(true);
    expect(isStudyRoute('/review')).toBe(true);
    expect(isStudyRoute('/my/section')).toBe(false);
    expect(isStudyRoute('/')).toBe(false);
  });
});

const course = (id: string, title = id): Course =>
  ({ id, title, sections: [], provenance: { kind: 'pdf', documentId: id, citations: [] } }) as unknown as Course;

/** An account and a browser, both in memory. */
function world(start: { remote?: Record<string, { updatedAt: number; course: Course }>; local?: Course[]; meta?: SyncMeta } = {}) {
  const remote = new Map(Object.entries(start.remote ?? {}));
  let local = start.local ?? [];
  let meta = start.meta ?? {};
  let clock = 1000;
  const calls: string[] = [];
  const refuse = new Map<string, { code: string; message: string }>();
  const io: CourseSyncIo = {
    listRemote: async () => [...remote].map(([id, r]): CourseIndexEntry => ({ id, updatedAt: r.updatedAt })),
    getRemote: async (id) => {
      calls.push(`get ${id}`);
      return remote.get(id)!;
    },
    putRemote: async (c) => {
      calls.push(`put ${c.id}`);
      const refusal = refuse.get(c.id);
      if (refusal) throw Object.assign(new Error(refusal.message), { code: refusal.code });
      const updatedAt = ++clock;
      remote.set(c.id, { updatedAt, course: c });
      return { updatedAt };
    },
    deleteRemote: async (id) => {
      calls.push(`delete ${id}`);
      remote.delete(id);
    },
    readLocal: () => local,
    writeLocal: (next) => {
      local = next;
    },
    readMeta: () => ({ ...meta }),
    writeMeta: (next) => {
      meta = next;
    },
  };
  return { io, remote, calls, refuse, local: () => local, meta: () => meta };
}

describe('syncing courses with the account', () => {
  it('uploads a course made on this device', async () => {
    const w = world({ local: [course('a')] });
    const out = await syncCourses(w.io);
    expect(out).toMatchObject({ pushed: 1, pulled: 0, removed: 0 });
    expect(w.remote.has('a')).toBe(true);
    expect(w.meta().a.dirty).toBeUndefined();
    // Nothing changed, so a second run does nothing.
    w.calls.length = 0;
    await syncCourses(w.io);
    expect(w.calls).toEqual([]);
  });

  it('downloads courses made on another device', async () => {
    const w = world({ remote: { a: { updatedAt: 5, course: course('a') }, b: { updatedAt: 9, course: course('b') } } });
    const out = await syncCourses(w.io);
    expect(out.pulled).toBe(2);
    expect(w.local().map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('takes the newer copy from the account when this device has no changes', async () => {
    const w = world({ remote: { a: { updatedAt: 9, course: course('a', 'new title') } }, local: [course('a', 'old title')], meta: { a: { updatedAt: 5 } } });
    await syncCourses(w.io);
    expect(w.local()[0].title).toBe('new title');
  });

  it('keeps local changes that were not uploaded yet', async () => {
    const w = world({ remote: { a: { updatedAt: 9, course: course('a', 'server') } }, local: [course('a', 'mine')], meta: { a: { updatedAt: 5, dirty: true } } });
    await syncCourses(w.io);
    expect(w.local()[0].title).toBe('mine');
    expect(w.remote.get('a')!.course.title).toBe('mine');
  });

  it('removes a course that was deleted on another device', async () => {
    const w = world({ local: [course('a'), course('b')], meta: { a: { updatedAt: 5 }, b: { updatedAt: 6 } }, remote: { b: { updatedAt: 6, course: course('b') } } });
    const out = await syncCourses(w.io);
    expect(out.removed).toBe(1);
    expect(w.local().map((c) => c.id)).toEqual(['b']);
  });

  it('never removes a course that has not reached the account', async () => {
    const w = world({ local: [course('fresh')] });
    await syncCourses(w.io);
    expect(w.local().map((c) => c.id)).toEqual(['fresh']);
    expect(w.calls).toEqual(['put fresh']);
  });

  it('deletes in the account what was deleted here, and does not download it again', async () => {
    const w = world({ remote: { a: { updatedAt: 5, course: course('a') } }, meta: { a: { updatedAt: 5, deleted: true } } });
    await syncCourses(w.io);
    expect(w.remote.has('a')).toBe(false);
    expect(w.local()).toEqual([]);
    expect(w.meta()).toEqual({});
  });

  it('reports a full account and tries again later', async () => {
    const w = world({ local: [course('a')] });
    w.refuse.set('a', { code: 'limit_reached', message: 'Your account can hold 2 courses.' });
    const out = await syncCourses(w.io);
    expect(out.problems).toEqual(['Your account can hold 2 courses.']);
    expect(w.local()).toHaveLength(1);
    expect(w.meta().a.dirty).toBe(true);
    w.refuse.clear();
    expect((await syncCourses(w.io)).pushed).toBe(1);
  });

  it('drops a course the owner took offline', async () => {
    const w = world({ local: [course('a')], meta: { a: { updatedAt: 5, dirty: true } } });
    w.refuse.set('a', { code: 'forbidden', message: 'This course was taken offline by the site owner.' });
    const out = await syncCourses(w.io);
    expect(out.removed).toBe(1);
    expect(w.local()).toEqual([]);
  });

  it('stops without changing anything when the network fails', async () => {
    const w = world({ local: [course('a')] });
    w.io.listRemote = () => Promise.reject(Object.assign(new Error('offline'), { code: 'network' }));
    await expect(syncCourses(w.io)).rejects.toMatchObject({ code: 'network' });
    expect(w.local()).toHaveLength(1);
  });
});
