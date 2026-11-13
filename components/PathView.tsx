'use client';

import { Check, Clock, Lock, Star, Trophy, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Course } from '@/lib/learning/types';
import { isDemo } from '@/lib/learning/types';
import { courseProgress, sectionStatuses, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { DemoTag, ProgressBar } from './ui';

// Path geometry in px. Nodes zig-zag; an SVG line is drawn through their centres.
const ROW = 128;
const ORB = 80;
const OFFSETS = [0, 46, 76, 46];
const TOP = 10;
const centre = (i: number) => ({ x: OFFSETS[i % OFFSETS.length] + ORB / 2, y: TOP + i * ROW + ORB / 2 });

function curve(from: number, to: number) {
  let d = '';
  for (let i = from; i <= to; i++) {
    const p = centre(i);
    if (i === from) d += `M${p.x} ${p.y}`;
    else {
      const q = centre(i - 1);
      d += ` C${q.x} ${q.y + ROW / 2} ${p.x} ${p.y - ROW / 2} ${p.x} ${p.y}`;
    }
  }
  return d;
}

export function PathView({ course }: { course: Course }) {
  const router = useRouter();
  const { state } = useProgress();
  const ids = course.sections.map((s) => s.id);
  const statuses = sectionStatuses(course.id, ids, state);
  const progress = courseProgress(course.id, ids, state);
  const activeIndex = statuses.indexOf('active');
  const reached = activeIndex >= 0 ? activeIndex : ids.length - 1;
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const open = (i: number) => {
    if (statuses[i] === 'locked') {
      const need = course.sections[Math.max(activeIndex, 0)];
      setToast(`Finish “${need.title}” to unlock this section.`);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(''), 2800);
      return;
    }
    router.push(`/courses/${course.id}/${ids[i]}`);
  };

  const total = course.sections.length;
  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader backHref="/courses" backLabel="Back to courses" />
        <div className="hero-title">
          <p className="kicker">
            {course.code} – {course.title} {isDemo(course.provenance) && <DemoTag />}
          </p>
          <h1>
            {course.unitLabel}: <span>{course.unitTitle}</span>
          </h1>
          <div className="progressline">
            <span>
              {progress.done} of {progress.total} sections
            </span>
            <b>{progress.pct}% Complete</b>
          </div>
          <ProgressBar value={progress.pct} label="Course progress" />
        </div>
      </section>

      <section className="path" style={{ height: TOP + total * ROW + 96 }} aria-label="Learning path">
        <svg className="path-line" width="160" height={TOP + total * ROW} aria-hidden="true">
          <path d={curve(0, total - 1)} className="path-track" />
          {reached > 0 && <path d={curve(0, reached)} className="path-done" />}
        </svg>
        {course.sections.map((s, i) => {
          const status = statuses[i];
          const result = state.completed[`${course.id}/${s.id}`];
          return (
            <button
              key={s.id}
              ref={status === 'active' ? activeRef : undefined}
              type="button"
              className={`node node-${status}`}
              style={{ top: TOP + i * ROW, paddingLeft: OFFSETS[i % OFFSETS.length] }}
              onClick={() => open(i)}
              aria-label={`Section ${i + 1}: ${s.title}. ${status === 'done' ? 'Completed' : status === 'active' ? 'Ready to start' : 'Locked'}`}
            >
              <span className="orb">
                {status === 'done' ? <Check size={34} strokeWidth={3.2} /> : status === 'active' ? <Star size={34} fill="currentColor" /> : <Lock size={26} />}
              </span>
              <span className="node-text">
                <small>SECTION {i + 1}</small>
                <b>{s.title}</b>
                {status === 'active' && <em className="pill pill-gold">START</em>}
                {status === 'done' && (
                  <span className="node-meta ok">
                    <Check size={13} strokeWidth={3} /> {result && !result.demo ? `Completed • ${result.score}/${result.total}` : 'Completed'}
                  </span>
                )}
                {status !== 'done' && (
                  <span className="node-meta">
                    <Clock size={13} /> {s.estMinutes}
                    <Zap size={13} /> +{s.xpReward} XP
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <div className={`path-finish ${progress.pct === 100 ? 'won' : ''}`} style={{ top: TOP + total * ROW }}>
          <Trophy size={22} />
          <span>{progress.pct === 100 ? 'Course complete. Nice work, Lion!' : `Finish all ${total} sections to complete the course`}</span>
        </div>
      </section>

      <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
        <Lock size={16} /> {toast}
      </div>
    </main>
  );
}
