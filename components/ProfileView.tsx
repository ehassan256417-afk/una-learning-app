'use client';

import { CheckCircle2, CloudOff, Database, Download, Info, KeyRound, LayoutDashboard, LogOut, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/account/client';
import type { AccountUser, MyStats } from '@/lib/account/contracts';
import { useSession } from '@/lib/account/session';
import { useCourseSyncState } from '@/lib/learning/generated-store';
import { initialsOf, levelFor, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { Sheet } from './ui';

type Dialog = 'none' | 'reset' | 'password' | 'delete';

export function ProfileView() {
  const { state, setName, resetProgress, sync } = useProgress();
  const { mode, user, signOut, updateUser } = useSession();
  const courseSync = useCourseSyncState();
  const [dialog, setDialog] = useState<Dialog>('none');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setNameDraft] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [stats, setStats] = useState<MyStats | null>(null);
  const level = levelFor(state.xp);
  const signedIn = mode === 'user' && !!user;
  const shownName = (signedIn ? user.name : state.name).trim();

  useEffect(() => {
    setNameDraft(shownName);
  }, [shownName]);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    api<MyStats>('/api/me/stats', { signal: controller.signal })
      .then(setStats)
      .catch(() => undefined);
    return () => controller.abort();
  }, [signedIn]);

  const close = () => {
    setDialog('none');
    setError('');
    setCurrent('');
    setNext('');
  };

  /** Runs an account action and shows its outcome in one place. */
  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const message = await work();
      close();
      setNotice(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    const value = name.trim();
    if (!value || value === shownName) return;
    if (!signedIn) {
      setName(value);
      setNotice('Name saved on this device.');
      return;
    }
    void run(async () => {
      const result = await api<{ user: AccountUser }>('/api/me/profile', { method: 'PATCH', body: { name: value } });
      updateUser(result.user);
      return 'Name updated.';
    });
  };

  const exportData = () =>
    run(async () => {
      const data = await api<unknown>('/api/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'una-learning-my-data.json';
      link.click();
      URL.revokeObjectURL(url);
      return 'Your data was downloaded as a file.';
    });

  const saved = sync === 'saved' && (courseSync.status === 'saved' || courseSync.status === 'idle');

  return (
    <main className="screen with-nav">
      <section className="hero hero-compact hero-profile">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="profilehead">
          <span className="avatar avatar-xl">{initialsOf(shownName)}</span>
          <div>
            <h1>{shownName || 'Your profile'}</h1>
            <p>
              Level {level.level} • {level.title}
              {signedIn && user.beta ? ' • Beta tester' : ''}
            </p>
          </div>
        </div>
      </section>

      <div className="pad pad-top">
        {notice && (
          <div className="note note-info" role="status">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
          </div>
        )}

        {signedIn && user.role === 'owner' && (
          <Link href="/owner" className="uploadcta">
            <span className="uploadcta-ico">
              <LayoutDashboard size={24} />
            </span>
            <span>
              <b>Owner dashboard</b>
              <small>Visitors, students, AI usage and platform settings.</small>
            </span>
          </Link>
        )}

        <div className="card">
          <h2>{signedIn ? 'Account' : 'Display name'}</h2>
          {signedIn && <p className="muted">Signed in as {user.email}</p>}
          <label className="field">
            <span className="sr-only">Display name</span>
            <input type="text" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setNameDraft(e.target.value)} placeholder="Your first name" />
          </label>
          <button type="button" className="btn btn-outline gap-top" onClick={saveName} disabled={busy || !name.trim() || name.trim() === shownName}>
            Save name
          </button>
          {dialog === 'none' && error && (
            <p className="muted" role="alert">
              {error}
            </p>
          )}
        </div>

        {signedIn && (
          <div className="card infocard">
            <span className="infocard-ico">{saved ? <CheckCircle2 size={20} /> : <CloudOff size={20} />}</span>
            <div>
              <h2>{saved ? 'Saved to your account' : sync === 'offline' || courseSync.status === 'offline' ? 'Waiting for a connection' : 'Saving…'}</h2>
              <p>
                Your courses and progress are stored in your account, so they are here when you sign in on another device.
                {courseSync.status === 'problem' && courseSync.message ? ` ${courseSync.message}` : ''}
              </p>
              {stats && (
                <p className="muted">
                  {stats.courses} of {stats.courseLimit} courses used • {stats.aiRequestsToday} of {stats.aiDailyLimit} AI requests used today •{' '}
                  {Math.round(stats.totalStudyMin)} min studied
                </p>
              )}
            </div>
          </div>
        )}

        {!signedIn && (
          <div className="card infocard">
            <span className="infocard-ico">
              <Database size={20} />
            </span>
            <div>
              <h2>Saved on this device</h2>
              <p>Accounts are not connected on this site yet, so your courses and progress stay in this browser only.</p>
            </div>
          </div>
        )}

        {signedIn && (
          <div className="card">
            <h2>Security and data</h2>
            <div className="actionlist">
              <button type="button" onClick={() => setDialog('password')}>
                <KeyRound size={18} /> Change password
              </button>
              <button type="button" onClick={() => void exportData()} disabled={busy}>
                <Download size={18} /> Download my data
              </button>
              <button type="button" onClick={() => void signOut()}>
                <LogOut size={18} /> Sign out
              </button>
            </div>
            <p className="muted">Signing out saves any pending changes first, then removes your data from this browser.</p>
          </div>
        )}

        <div className="card infocard">
          <span className="infocard-ico">
            <Info size={20} />
          </span>
          <div>
            <h2>Independent student project</h2>
            <p>
              UNA Learning is built by a student for students. It is not an official University of North Alabama
              application and is not affiliated with or endorsed by the university.
            </p>
          </div>
        </div>

        <div className="card">
          <h2>Start over</h2>
          <div className="actionlist">
            <button type="button" className="danger" onClick={() => setDialog('reset')}>
              <RotateCcw size={18} /> Reset my progress
            </button>
            {signedIn && user.role !== 'owner' && (
              <button type="button" className="danger" onClick={() => setDialog('delete')}>
                <Trash2 size={18} /> Delete my account
              </button>
            )}
          </div>
        </div>
      </div>

      <Sheet open={dialog === 'reset'} onClose={close} title="Reset progress?">
        <p>This clears your XP, streak, finished lessons and review schedule{signedIn ? ' in your account' : ''}. Your courses stay. It cannot be undone.</p>
        <div className="actionbar inline">
          <button type="button" className="btn btn-outline" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => {
              resetProgress();
              close();
              setNotice('Progress was reset.');
            }}
          >
            Reset
          </button>
        </div>
      </Sheet>

      <Sheet open={dialog === 'password'} onClose={close} title="Change password">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (next.length < 8) {
              setError('The new password needs at least 8 characters.');
              return;
            }
            void run(async () => {
              await api('/api/auth/password', { body: { current, next } });
              return 'Password changed. Your other devices were signed out.';
            });
          }}
        >
          {error && (
            <div className="note note-error" role="alert">
              <span>{error}</span>
            </div>
          )}
          <label className="field">
            <span>Current password</span>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required maxLength={200} />
          </label>
          <label className="field">
            <span>New password (8 characters or more)</span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required maxLength={200} />
          </label>
          <div className="actionbar inline">
            <button type="button" className="btn btn-outline" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-gold" disabled={busy}>
              Change
            </button>
          </div>
        </form>
      </Sheet>

      <Sheet open={dialog === 'delete'} onClose={close} title="Delete your account?">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/api/me', { method: 'DELETE', body: { password: current } });
              await signOut();
              return 'Your account was deleted.';
            });
          }}
        >
          <p>This permanently deletes your account, your courses and your progress. It cannot be undone. Enter your password to confirm.</p>
          {error && (
            <div className="note note-error" role="alert">
              <span>{error}</span>
            </div>
          )}
          <label className="field">
            <span>Password</span>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required maxLength={200} />
          </label>
          <div className="actionbar inline">
            <button type="button" className="btn btn-outline" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-gold btn-danger" disabled={busy}>
              Delete account
            </button>
          </div>
        </form>
      </Sheet>
    </main>
  );
}
