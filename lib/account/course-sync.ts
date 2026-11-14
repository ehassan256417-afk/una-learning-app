import type { Course } from '../learning/types.ts';
import type { CourseIndexEntry } from './contracts.ts';

/**
 * Keeps the courses saved in this browser in step with the student's account.
 *
 * The browser copy is a cache that makes the app fast and usable offline; the
 * account is what follows the student to another device. Rules:
 * - a course saved here and not yet uploaded ("dirty") is uploaded;
 * - a course in the account that is missing or older here is downloaded;
 * - a course that was synced before and is gone from the account (deleted on
 *   another device, or taken offline by the owner) is removed here;
 * - a course deleted here is deleted in the account.
 * A course is never removed from this browser unless it was safely in the
 * account first, so work in progress cannot be lost to a sync.
 *
 * Storage and network are passed in, so the rules are tested in Node.
 */

export type SyncMeta = Record<string, { updatedAt: number; dirty?: boolean; deleted?: boolean }>;

export interface CourseSyncIo {
  listRemote(): Promise<CourseIndexEntry[]>;
  getRemote(id: string): Promise<{ updatedAt: number; course: Course }>;
  putRemote(course: Course): Promise<{ updatedAt: number }>;
  deleteRemote(id: string): Promise<void>;
  readLocal(): Course[];
  writeLocal(courses: Course[]): void;
  readMeta(): SyncMeta;
  writeMeta(meta: SyncMeta): void;
}

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  removed: number;
  /** Messages worth showing the student, e.g. the account is full. */
  problems: string[];
}

const codeOf = (err: unknown): string => (typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'unknown');
const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'Could not save to your account.');

export async function syncCourses(io: CourseSyncIo): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { pulled: 0, pushed: 0, removed: 0, problems: [] };
  // Local state is re-read around every network call, so a course saved while a sync runs is never overwritten.
  const setMeta = (id: string, value: SyncMeta[string] | null) => {
    const meta = io.readMeta();
    if (value) meta[id] = value;
    else delete meta[id];
    io.writeMeta(meta);
  };
  const dropLocal = (id: string) => io.writeLocal(io.readLocal().filter((c) => c.id !== id));

  const remote = new Map((await io.listRemote()).map((r) => [r.id, r.updatedAt]));

  for (const [id, m] of Object.entries(io.readMeta())) {
    if (!m.deleted) continue;
    await io.deleteRemote(id);
    remote.delete(id);
    setMeta(id, null);
  }

  for (const snapshot of io.readLocal()) {
    const id = snapshot.id;
    const m = io.readMeta()[id];
    if (!m || m.dirty) {
      try {
        const saved = await io.putRemote(snapshot);
        // If the course changed again while uploading, it stays dirty for the next round.
        const now = io.readLocal().find((c) => c.id === id);
        setMeta(id, { updatedAt: saved.updatedAt, ...(now && now !== snapshot && JSON.stringify(now) !== JSON.stringify(snapshot) ? { dirty: true } : {}) });
        remote.set(id, saved.updatedAt);
        outcome.pushed++;
      } catch (err) {
        if (codeOf(err) === 'forbidden') {
          // Taken offline by the owner: it leaves this browser too.
          dropLocal(id);
          setMeta(id, null);
          outcome.removed++;
          outcome.problems.push(messageOf(err));
        } else if (codeOf(err) === 'limit_reached') {
          setMeta(id, { updatedAt: m?.updatedAt ?? 0, dirty: true });
          outcome.problems.push(messageOf(err));
        } else {
          throw err;
        }
      }
      continue;
    }
    const remoteAt = remote.get(id);
    if (remoteAt === undefined) {
      dropLocal(id);
      setMeta(id, null);
      outcome.removed++;
    } else if (remoteAt > m.updatedAt) {
      const fresh = await io.getRemote(id);
      if (!io.readMeta()[id]?.dirty) {
        io.writeLocal(io.readLocal().map((c) => (c.id === id ? fresh.course : c)));
        setMeta(id, { updatedAt: fresh.updatedAt });
        outcome.pulled++;
      }
    }
  }

  const have = new Set(io.readLocal().map((c) => c.id));
  for (const [id] of [...remote].sort((a, b) => b[1] - a[1])) {
    if (have.has(id) || io.readMeta()[id]?.deleted) continue;
    const fresh = await io.getRemote(id);
    if (io.readLocal().some((c) => c.id === id)) continue;
    io.writeLocal([...io.readLocal(), fresh.course]);
    if (!io.readLocal().some((c) => c.id === id)) {
      // The browser's storage is full. The course is safe in the account; stop here instead of pushing others out.
      outcome.problems.push('This device has no room for more courses. They are still saved in your account.');
      break;
    }
    setMeta(id, { updatedAt: fresh.updatedAt });
    outcome.pulled++;
  }
  return outcome;
}
