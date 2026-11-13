'use client';

import { Check, Flame, Zap } from 'lucide-react';
import Link from 'next/link';
import type { CourseSummary } from '@/lib/learning/types';
import { computeBadges } from '@/lib/progress/badges';
import { courseProgress, levelFor, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { BadgeMedal, DemoTag, ProgressBar } from './ui';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ProgressView({ courses }: { courses: CourseSummary[] }) {
  const { state, ready } = useProgress();
  const level = levelFor(state.xp);
  const badges = computeBadges(state, courses);
  const sectionsDone = Object.keys(state.completed).length;
  const sectionsTotal = courses.reduce((n, c) => n + c.sectionIds.length, 0);

  // Last 7 days ending today; the streak lights the most recent days.
  const today = ready ? new Date().getDay() : 0;
  const week = Array.from({ length: 7 }, (_, i) => {
    const daysAgo = 6 - i;
    return { label: DAYS[(today - daysAgo + 7) % 7], lit: ready && daysAgo < Math.min(state.streak, 7), today: daysAgo === 0 };
  });

  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="hero-title">
          <h1>Your Progress</h1>
          <p>Practice regularly, earn XP and keep your streak alive.</p>
        </div>
      </section>

      <div className="pad pad-top">
        <p className="demo-line">
          <DemoTag /> Starting stats are sample values. Lessons you finish here are added on top.
        </p>

        <div className="card levelcard">
          <div className="levelring" style={{ ['--pct' as string]: `${level.pct}%` }}>
            <span>
              <small>LEVEL</small>
              <b>{level.level}</b>
            </span>
          </div>
          <div className="levelcard-body">
            <h2>{level.title}</h2>
            <p>
              <Zap size={15} fill="currentColor" className="c-gold" /> <b>{state.xp} XP</b> total
            </p>
            <ProgressBar value={level.pct} tone="purple" label="Progress to next level" />
            <small>
              {level.toNext} XP to level {level.level + 1}
            </small>
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h2>
              <Flame size={20} fill="currentColor" className="c-fire" /> {state.streak}-day streak
            </h2>
            <small>Last 7 days</small>
          </div>
          <div className="week">
            {week.map((d, i) => (
              <div key={i} className={`${d.lit ? 'lit' : ''} ${d.today ? 'today' : ''}`}>
                <span>{d.lit ? <Check size={16} strokeWidth={3.4} /> : null}</span>
                <small>{d.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h2>Courses</h2>
            <small>
              {sectionsDone} of {sectionsTotal} sections
            </small>
          </div>
          <ul className="courseprogress">
            {courses.map((c) => {
              const p = courseProgress(c.id, c.sectionIds, state);
              return (
                <li key={c.id}>
                  <Link href={`/courses/${c.id}`}>
                    <span>
                      <b>{c.code}</b> {c.title}
                    </span>
                    <b>{p.pct}%</b>
                  </Link>
                  <ProgressBar value={p.pct} tone={p.pct === 100 ? 'green' : 'purple'} label={`${c.code} progress`} />
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card" id="badges">
          <div className="cardhead">
            <h2>Badges</h2>
            <small>
              {badges.filter((b) => b.earned).length} of {badges.length} earned
            </small>
          </div>
          <div className="badgegrid">
            {badges.map((b) => (
              <BadgeMedal key={b.id} badge={b} showHint />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
