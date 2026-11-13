'use client';

import { Database, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { initialsOf, levelFor, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { Sheet } from './ui';

export function ProfileView() {
  const { state, setName, resetDemo } = useProgress();
  const [confirm, setConfirm] = useState(false);
  const [didReset, setDidReset] = useState(false);
  const level = levelFor(state.xp);

  return (
    <main className="screen with-nav">
      <section className="hero hero-compact hero-profile">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="profilehead">
          <span className="avatar avatar-xl">{initialsOf(state.name)}</span>
          <div>
            <h1>{state.name.trim() || 'Lion'}</h1>
            <p>
              Level {level.level} • {level.title}
            </p>
          </div>
        </div>
      </section>

      <div className="pad pad-top">
        <div className="card">
          <h2>Display name</h2>
          <label className="field">
            <span className="sr-only">Display name</span>
            <input
              type="text"
              value={state.name}
              maxLength={24}
              autoComplete="given-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Your first name"
            />
          </label>
          <p className="muted">Used for the welcome message. Saved on this device only.</p>
        </div>

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

        <div className="card infocard">
          <span className="infocard-ico">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2>Demo data</h2>
            <p>
              Courses, lessons, quizzes and starting stats are sample content. No PDF is uploaded or analyzed, and no
              AI service is called.
            </p>
          </div>
        </div>

        <div className="card infocard">
          <span className="infocard-ico">
            <Database size={20} />
          </span>
          <div>
            <h2>Your data</h2>
            <p>Progress is stored in this browser only. There are no accounts and nothing is sent to a server.</p>
            <button type="button" className="btn btn-outline btn-danger" onClick={() => setConfirm(true)}>
              <RotateCcw size={18} /> Reset demo progress
            </button>
            {didReset && (
              <p className="muted" role="status">
                Progress was reset to the demo starting point.
              </p>
            )}
          </div>
        </div>
      </div>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Reset progress?">
        <p>This clears the lessons you finished here and restores the sample starting stats. It cannot be undone.</p>
        <div className="actionbar inline">
          <button type="button" className="btn btn-outline" onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => {
              resetDemo();
              setConfirm(false);
              setDidReset(true);
            }}
          >
            Reset
          </button>
        </div>
      </Sheet>
    </main>
  );
}
