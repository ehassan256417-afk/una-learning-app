'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adoptDeviceCourses, flushCourses, syncCoursesNow } from '../learning/generated-store';
import {
  api,
  API_URL,
  ApiError,
  clearAccountCache,
  readSession,
  registerFlusher,
  runFlushers,
  setExpiredHandler,
  writeSession,
} from './client';
import type { AccountUser, AuthResponse, PublicConfig } from './contracts';
import { startTracker, visitorId } from './tracker';

/**
 * Who is using the app.
 *
 *   loading  the first paint, before the browser's storage has been read
 *   local    this build has no backend (the static demo): everything stays on the device
 *   guest    a visitor who is not signed in: they see the public site only
 *   user     a signed-in student (or the owner)
 */
export type SessionMode = 'loading' | 'local' | 'guest' | 'user';

/** Used until the backend's settings arrive, and in the device-only build. */
export const DEFAULT_CONFIG: PublicConfig = {
  registration: 'open',
  features: { generation: true, pptxUpload: true, spacedReview: true, sampleCourses: true },
  announcement: null,
  site: { tagline: 'Turn your course PDFs and slides into short lessons, quizzes and spaced review.', supportEmail: '' },
  learning: { reviewSessionSize: 15, dailyGoalXp: 50 },
};

/** Set when an account is created in this browser, so work done here before signing up moves into it. */
export const ADOPT_KEY = 'una-learning:adopt';

interface SessionApi {
  mode: SessionMode;
  user: AccountUser | null;
  config: PublicConfig;
  /** True when the backend could not be reached; cached data is shown meanwhile. */
  offline: boolean;
  signIn(email: string, password: string): Promise<void>;
  register(input: { email: string; name: string; password: string; inviteCode?: string }): Promise<void>;
  resetPassword(input: { email: string; code: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
  /** Replaces the cached account details after a profile change. */
  updateUser(user: AccountUser): void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<SessionMode>('loading');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [offline, setOffline] = useState(false);

  const accept = useCallback((auth: AuthResponse) => {
    writeSession({ token: auth.token, user: auth.user });
    setUser(auth.user);
    setMode('user');
    setOffline(false);
    void syncCoursesNow();
  }, []);

  useEffect(() => {
    if (!API_URL) {
      setMode('local');
      return;
    }
    startTracker();
    const controller = new AbortController();
    const stored = readSession();
    if (stored) {
      // Show the app at once from the cached session, then confirm it with the backend.
      setUser(stored.user);
      setMode('user');
    }
    setExpiredHandler(() => {
      writeSession(null);
      setUser(null);
      setMode('guest');
    });

    api<PublicConfig>('/api/public/config', { signal: controller.signal })
      .then((c) => {
        setConfig(c);
        setOffline(false);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && err instanceof ApiError && err.code === 'network') setOffline(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMode((m) => (m === 'loading' ? 'guest' : m));
      });

    if (stored) {
      api<{ user: AccountUser }>('/api/me', { signal: controller.signal })
        .then(({ user: fresh }) => {
          writeSession({ token: stored.token, user: fresh });
          setUser(fresh);
          void syncCoursesNow();
        })
        .catch(() => undefined);
    }
    const offFlush = registerFlusher(flushCourses);
    // Coming back to the tab picks up what another device saved meanwhile.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && readSession()) void syncCoursesNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      offFlush();
      setExpiredHandler(null);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const value = useMemo<SessionApi>(
    () => ({
      mode,
      user,
      config,
      offline,
      async signIn(email, password) {
        accept(await api<AuthResponse>('/api/auth/login', { body: { email, password, visitorId: visitorId() || undefined }, quiet401: true }));
      },
      async register(input) {
        const auth = await api<AuthResponse>('/api/auth/register', { body: { ...input, visitorId: visitorId() || undefined }, quiet401: true });
        // Lessons and progress made in this browser before signing up belong to the new account.
        adoptDeviceCourses(auth.user.id);
        try {
          window.sessionStorage.setItem(ADOPT_KEY, auth.user.id);
        } catch {
          /* ignore */
        }
        accept(auth);
      },
      async resetPassword(input) {
        accept(await api<AuthResponse>('/api/auth/reset', { body: input, quiet401: true }));
      },
      async signOut() {
        const id = user?.id ?? '';
        // Anything not yet saved to the account goes up first; then this browser forgets the account.
        await runFlushers();
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        writeSession(null);
        clearAccountCache(id);
        // Slide pictures read on this device go too, so the next person here cannot see them.
        try {
          window.indexedDB?.deleteDatabase('una-learning-figures');
        } catch {
          /* ignore */
        }
        setUser(null);
        setMode('guest');
      },
      updateUser(next) {
        const stored = readSession();
        if (stored) writeSession({ token: stored.token, user: next });
        setUser(next);
      },
    }),
    [mode, user, config, offline, accept],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
