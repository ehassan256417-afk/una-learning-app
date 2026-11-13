'use client';

import { ArrowRight, ArrowUp, BarChart3, CloudUpload, Flame, Play, Zap } from 'lucide-react';
import Link from 'next/link';
import { useAllCourses } from '@/lib/learning/generated-store';
import { sectionPath } from '@/lib/learning/links';
import type { CourseSummary } from '@/lib/learning/types';
import { computeBadges } from '@/lib/progress/badges';
import { levelFor, sectionStatuses, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { CourseCard } from './CourseCard';
import { LionMascot } from './LionMascot';
import { BadgeMedal, DemoTag } from './ui';

/** The next thing to study: the active section of the first unfinished course. */
function nextLessonHref(courses: CourseSummary[], state: ReturnType<typeof useProgress>['state']) {
  for (const c of courses) {
    const i = sectionStatuses(c.id, c.sectionIds, state).indexOf('active');
    if (i >= 0) return sectionPath(c, c.sectionIds[i]);
  }
  return '/courses';
}

export function DashboardView({ courses: demoCourses }: { courses: CourseSummary[] }) {
  const { state } = useProgress();
  // The student's PDF courses come first, then the sample courses.
  const { all: courses, generated } = useAllCourses(demoCourses);
  const level = levelFor(state.xp);
  const badges = computeBadges(state, courses);
  const earned = badges.filter((b) => b.earned).length;
  const firstName = state.name.trim().split(/\s+/)[0] || 'Lion';

  return (
    <main className="screen with-nav">
      <section className="hero hero-home">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="hero-copy">
          <h1>
            Welcome back,
            <br />
            <span>{firstName}!</span> <span aria-hidden="true">👋</span>
          </h1>
          <p>Turn your course PDFs into interactive lessons and level up your learning.</p>
        </div>
        <LionMascot variant="full" size={178} className="hero-lion" />
        <svg className="hero-swoosh" viewBox="0 0 430 70" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 52 C120 4 250 78 430 14 L430 30 C260 92 120 22 0 66Z" fill="#FFC93C" />
        </svg>
      </section>

      <section className="statrow" aria-label="Your stats (demo data)">
        <Link href="/progress" className="statcard">
          <span className="statico statico-xp">
            <Zap size={20} fill="currentColor" />
          </span>
          <span>
            <b>
              {state.xp} <small>XP</small>
            </b>
            {state.todayXp > 0 ? (
              <em className="up">
                <ArrowUp size={12} /> +{state.todayXp} today
              </em>
            ) : (
              <em>Total earned</em>
            )}
          </span>
        </Link>
        <Link href="/progress" className="statcard">
          <span className="statico statico-fire">
            <Flame size={20} fill="currentColor" />
          </span>
          <span>
            <b>{state.streak} Day</b>
            <em>Streak</em>
          </span>
        </Link>
        <Link href="/progress" className="statcard">
          <span className="statico statico-level">
            <BarChart3 size={20} />
          </span>
          <span>
            <b>Level {level.level}</b>
            <em>{level.title}</em>
          </span>
        </Link>
      </section>

      <div className="pad">
        <Link href={nextLessonHref(courses, state)} className="btn btn-gold btn-xl start-btn">
          <Play size={20} fill="currentColor" /> Start Learning <ArrowRight size={20} />
        </Link>
        <p className="demo-line">
          <DemoTag />{' '}
          {generated.length > 0
            ? 'Courses marked Demo and the starting stats are sample content.'
            : 'Sample courses and stats. Upload a PDF to build your own lessons.'}
        </p>

        <div className="sectionhead">
          <h2>My Courses</h2>
          <Link href="/upload" className="chip-btn">
            <CloudUpload size={18} /> Upload PDF
          </Link>
        </div>
        <div className="stack">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>

        <div className="sectionhead">
          <h2>
            My Badges <span className="count">({earned})</span>
          </h2>
          <Link href="/progress#badges" className="textlink">
            View All <ArrowRight size={16} />
          </Link>
        </div>
        <div className="badgerow">
          {badges.map((b) => (
            <BadgeMedal key={b.id} badge={b} />
          ))}
        </div>
      </div>
    </main>
  );
}
