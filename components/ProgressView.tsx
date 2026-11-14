'use client';

import { ArrowRight, Brain, Check, Flame, Repeat, Zap } from 'lucide-react';
import Link from 'next/link';
import { useAllCourses, useStudyCourses } from '@/lib/learning/generated-store';
import { coursePath, isGeneratedCourse, sectionPath } from '@/lib/learning/links';
import type { CourseSummary } from '@/lib/learning/types';
import { sourceName } from '@/lib/learning/types';
import { dayIndex, describeDue, dueItems, nextDueDay, summarizeMastery } from '@/lib/progress/mastery';
import { computeBadges } from '@/lib/progress/badges';
import { courseProgress, levelFor, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { BadgeMedal, DemoTag, ProgressBar } from './ui';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ProgressView({ courses: demoCourses }: { courses: CourseSummary[] }) {
  const { state, ready } = useProgress();
  const { all: courses } = useAllCourses(demoCourses);
  const level = levelFor(state.xp);
  const badges = computeBadges(state, courses);
  const sectionsDone = courses.reduce((n, c) => n + courseProgress(c.id, c.sectionIds, state).done, 0);
  const sectionsTotal = courses.reduce((n, c) => n + c.sectionIds.length, 0);
  const study = useStudyCourses();
  const todayIndex = dayIndex(new Date());
  const dueNow = ready ? dueItems(study, state.review, todayIndex).length : 0;
  const nextDue = ready ? nextDueDay(study, state.review) : null;
  const mastery = summarizeMastery(study, ready ? state.review : {});
  const share = (n: number) => `${mastery.practised ? (n / mastery.practised) * 100 : 0}%`;

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

        <div className="card masterycard">
          <div className="cardhead">
            <h2>
              <Brain size={20} className="c-purple" /> Mastery
            </h2>
            <small>
              {mastery.practised} concept{mastery.practised === 1 ? '' : 's'} practised
            </small>
          </div>
          {mastery.practised === 0 ? (
            <p className="muted">
              Finish a lesson to start tracking how well you know each concept. Questions you miss are marked weak
              until you recall them in a later review.
            </p>
          ) : (
            <>
              <div
                className="masterybar"
                role="img"
                aria-label={`${mastery.weak.length} weak, ${mastery.learning} learning, ${mastery.strong} strong`}
              >
                <i className="m-weak" style={{ width: share(mastery.weak.length) }} />
                <i className="m-learning" style={{ width: share(mastery.learning) }} />
                <i className="m-strong" style={{ width: share(mastery.strong) }} />
              </div>
              <div className="masterykey">
                <span className="m-weak">{mastery.weak.length} weak</span>
                <span className="m-learning">{mastery.learning} learning</span>
                <span className="m-strong">{mastery.strong} strong</span>
              </div>
              {mastery.weak.length > 0 && (
                <ul className="weaklist" aria-label="Concepts to work on">
                  {mastery.weak.slice(0, 5).map((w) => {
                    const course = study.find((c) => c.id === w.courseId);
                    return (
                      <li key={`${w.courseId}/${w.sectionId}/${w.id}`}>
                        <Link href={course ? sectionPath(course, w.sectionId) : '/courses'}>
                          <span>
                            {w.name}
                            <small>{course?.title ?? 'Course'} • missed in practice</small>
                          </span>
                          <ArrowRight size={16} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          <Link href="/review" className="reviewcta">
            <Repeat size={20} />
            <span>
              <b>{dueNow > 0 ? `${dueNow} item${dueNow === 1 ? '' : 's'} due for review` : 'Review'}</b>
              {dueNow > 0
                ? 'Recall them now to move them to a longer gap.'
                : nextDue !== null
                  ? `Nothing due. Next review ${describeDue(nextDue, todayIndex)}.`
                  : 'Finished lessons come back here for spaced review.'}
            </span>
            <ArrowRight size={18} />
          </Link>
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
                  <Link href={coursePath(c)}>
                    <span>
                      <b>{isGeneratedCourse(c) ? `Your ${sourceName(c)}` : c.code}</b> {c.title}
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
