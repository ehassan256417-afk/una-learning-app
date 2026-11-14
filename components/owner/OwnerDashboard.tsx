'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/account/session';
import { AiTab } from './AiTab';
import { ContentTab } from './ContentTab';
import { OperationsTab } from './OperationsTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';
import { UsersTab } from './UsersTab';
import { clock } from './format';
import './owner.css';

type TabId = 'overview' | 'users' | 'ai' | 'content' | 'settings' | 'operations';

const TABS: Array<{ id: TabId; label: string; title: string; ranged: boolean }> = [
  { id: 'overview', label: 'Overview', title: 'Overview', ranged: true },
  { id: 'users', label: 'Users', title: 'Users', ranged: false },
  { id: 'ai', label: 'AI', title: 'AI usage', ranged: true },
  { id: 'content', label: 'Content', title: 'Content', ranged: false },
  { id: 'settings', label: 'Settings', title: 'Settings', ranged: false },
  { id: 'operations', label: 'Operations', title: 'Operations and audit log', ranged: false },
];

const RANGES = [7, 30, 90, 365] as const;

const fromHash = (): TabId => {
  const h = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? (h as TabId) : 'overview';
};

export function OwnerDashboard() {
  const { mode, user, signOut } = useSession();
  const [tab, setTab] = useState<TabId>('overview');
  const [days, setDays] = useState<number>(30);
  const [tick, setTick] = useState(0);
  const [updated, setUpdated] = useState<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setTab(fromHash());
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const isOwner = mode === 'user' && user?.role === 'owner';

  useEffect(() => {
    if (isOwner) setUpdated(Date.now());
  }, [isOwner, tab, days, tick]);

  const select = useCallback((id: TabId) => {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  if (mode === 'loading') {
    return (
      <div className="ow-root ow-center" role="status">
        <span className="ow-spinner" aria-hidden="true" /> Loading…
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="ow-root ow-center">
        <div className="ow-card ow-gate">
          <h1>Owner dashboard</h1>
          <p>This area is for the site owner.</p>
          <p className="ow-note">{mode === 'guest' ? 'Sign in with the owner account to continue.' : mode === 'local' ? 'Accounts are not connected on this site.' : 'You are signed in with a student account.'}</p>
          <div className="ow-actions">
            {mode === 'guest' && (
              <Link className="ow-btn ow-btn-primary" href="/login">
                Sign in
              </Link>
            )}
            <Link className="ow-btn" href="/">
              Back to the app
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="ow-root">
      <aside className="ow-side">
        <div className="ow-brand">
          <span className="ow-brand-mark" aria-hidden="true">
            U
          </span>
          <span>
            UNA Learning
            <small>Owner dashboard</small>
          </span>
        </div>
        <div className="ow-tabs" role="tablist" aria-label="Owner dashboard sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`ow-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="ow-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className="ow-tab"
              onClick={() => select(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ow-side-foot">
          <p className="ow-who" title={user?.email}>
            Signed in as
            <strong>{user?.email}</strong>
          </p>
          <Link className="ow-btn ow-btn-block" href="/">
            Back to the app
          </Link>
          <button type="button" className="ow-btn ow-btn-block" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="ow-main">
        <header className="ow-header">
          <h1>{current.title}</h1>
          <div className="ow-header-tools">
            {current.ranged && (
              <div className="ow-field ow-inline">
                <label htmlFor="ow-range">Period</label>
                <select id="ow-range" className="ow-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {RANGES.map((r) => (
                    <option key={r} value={r}>
                      Last {r} days
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" className="ow-btn" onClick={() => setTick((n) => n + 1)}>
              Refresh
            </button>
            {updated !== null && <span className="ow-updated">Updated {clock(updated)}</span>}
          </div>
        </header>
        <div id="ow-panel" role="tabpanel" aria-labelledby={`ow-tab-${tab}`} tabIndex={-1} className="ow-panel">
          {tab === 'overview' && <OverviewTab days={days} tick={tick} />}
          {tab === 'users' && <UsersTab tick={tick} />}
          {tab === 'ai' && <AiTab days={days} tick={tick} />}
          {tab === 'content' && <ContentTab tick={tick} />}
          {tab === 'settings' && <SettingsTab tick={tick} />}
          {tab === 'operations' && <OperationsTab tick={tick} />}
        </div>
      </main>
    </div>
  );
}
