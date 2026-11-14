'use client';

import { ArrowRight, ArrowUp, BarChart3, Brain, CloudUpload, Flame, Play, Repeat, Target, Timer, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/account/client';
import type { MyStats } from '@/lib/account/contracts';
import { useSession } from '@/lib/account/session';
import { useAllCourses, useStudyCourses } from '@/lib/learning/generated-store';
import { coursePath, sectionPath } from '@/lib/learning/links';
import type { Course, CourseSummary } from '@/lib/learning/types';
import { computeBadges } from '@/lib/progress/badges';
import { dayIndex, dueItems, summarizeMastery } from '@/lib/progress/mastery';
import { courseProgress, levelFor, sectionStatuses, useProgress, type ProgressState } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { CourseCard } from './CourseCard';
import { LionMascot } from './LionMascot';
import { BadgeMedal, ProgressBar } from './ui';

interface NextUp {
  href: string;
  course: string;
  lesson: string;
  /** True when the student has already finished something in this course. */
  started: boolean;
}

/** The next thing to study: the first unfinished lesson, preferring a course already in progress. */
function nextUp(courses: Course[], state: ProgressState): NextUp | null {
  const candidates: NextUp[] = [];
  for (const c of courses) {
    const ids = c.sections.map((s) => s.id);
    const statuses = sectionStatuses(c.id, ids, state);
    const i = statuses.indexOf('active');
    if (i < 0) continue;
    candidates.push({ href: sectionPath(c, ids[i]), course: c.title, lesson: c.sections[i].title, started: statuses.includes('done') });
  }
  return candidates.find((c) => c.started) ?? candidates[0] ?? null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DashboardView({ courses: demoCourses }: { courses: CourseSummary[] }) {
  const { state, ready } = useProgress();
  const { mode, user, config } = useSession();
  const samples = useMemo(() => (config.features.sampleCourses ? demoCourses : []), [config.features.sampleCourses, demoCourses]);
  const study = useStudyCourses(config.features.sampleCourses);
  const { all: courses, generated } = useAllCourses(samples);
  const [stats, setStats] = useState<MyStats | null>(null);

  useEffect(() => {
    if (mode !== 'user') return;
    const controller = new AbortController();
    api<MyStats>('/api/me/stats', { signal: controller.signal })
      .then(setStats)
      .catch(() => undefined);
    return () => controller.abort();
  }, [mode, user?.id]);

  const level = levelFor(state.xp);
  const badges = computeBadges(state, courses);
  const earned = badges.filter((b) => b.earned).length;
  const firstName = (state.name || user?.name || '').trim().split(/\s+/)[0];
  const reviewOn = config.features.spacedReview;
  const dueNow = ready && reviewOn ? dueItems(study, state.review, dayIndex(new Date())).length : 0;
  const mastery = summarizeMastery(study, ready ? state.review : {});
  const next = ready ? nextUp(study, state) : null;
  const lessonsDone = courses.reduce((n, c) => n + courseProgress(c.id, c.sectionIds, state).done, 0);
  const lessonsTotal = courses.reduce((n, c) => n + c.sectionIds.length, 0);
  const goal = config.learning.dailyGoalXp;
  const goalPct = Math.min(100, Math.round((state.todayXp / goal) * 100));
  const isNew = ready && state.xp === 0 && generated.length === 0;

  const week = stats?.days.slice(-7) ?? [];
  const weekStudy = Math.round(week.reduce((n, d) => n + d.studyMin, 0));
  const weekMax = Math.max(1, ...week.map((d) => d.studyMin));

  return (
    <main className="screen with-nav">
      <section className="hero hero-home">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="hero-copy">
          <h1>
            {isNew ? 'Welcome' : 'Welcome back'}
            {firstName ? ',' : '!'}
            {firstName && (
              <>
                <br />
                <span>{firstName}!</span>
              </>
            )}
          </h1>
          <p>{isNew ? 'Upload a chapter or a set of slides to build your first lessons.' : 'Pick up where you stopped and keep your streak going.'}</p>
        </div>
        <LionMascot variant="full" size={178} className="hero-lion" />
        <svg className="hero-swoosh" viewBox="0 0 430 70" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 52 C120 4 250 78 430 14 L430 30 C260 92 120 22 0 66Z" fill="#FFC93C" />
        </svg>
      </section>

      <section className="statrow" aria-label="Your stats">
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
        {next ? (
          <Link href={next.href} className="continuecard">
            <span className="continuecard-ico">
              <Play size={22} fill="currentColor" />
            </span>
            <span className="continuecard-body">
              <small>{next.started ? 'Continue learning' : 'Start here'}</small>
              <b>{next.lesson}</b>
              <em>{next.course}</em>
            </span>
            <ArrowRight size={20} />
          </Link>
        ) : (
          <Link href="/upload" className="btn btn-gold btn-xl start-btn">
            <CloudUpload size={20} /> Upload course material <ArrowRight size={20} />
          </Link>
        )}

        {dueNow > 0 && (
          <Link href="/review" className="reviewcta">
            <Repeat size={20} />
            <span>
              <b>
                {dueNow} item{dueNow === 1 ? '' : 's'} due for review
              </b>
              A few minutes of recall now keeps earlier lessons from fading.
            </span>
            <ArrowRight size={18} />
          </Link>
        )}

        <div className="card goalcard">
          <div className="cardhead">
            <h2>
              <Target size={20} className="c-purple" /> Today&apos;s goal
            </h2>
            <small>
              {Math.min(state.todayXp, goal)} of {goal} XP
            </small>
          </div>
          <ProgressBar value={goalPct} tone={goalPct === 100 ? 'green' : 'gold'} label="Progress to today's XP goal" />
          <p className="muted">
            {goalPct === 100
              ? 'Goal reached. Anything more today is a bonus.'
              : state.todayXp === 0
                ? 'One lesson or a short review session gets you started.'
                : `${goal - state.todayXp} XP to go.`}
          </p>
        </div>

        <div className="minigrid">
          <Link href="/progress" className="minicard">
            <b>
              {lessonsDone}
              <small> / {lessonsTotal}</small>
            </b>
            <span>Lessons completed</span>
            <em>{lessonsTotal - lessonsDone} still to do</em>
          </Link>
          <Link href="/progress" className="minicard">
            <b>{mastery.weak.length}</b>
            <span>
              <Brain size={14} aria-hidden="true" /> Weak concepts
            </span>
            <em>
              {mastery.strong} strong, {mastery.learning} learning
            </em>
          </Link>
        </div>

        {mastery.weak.length > 0 && (
          <div className="card">
            <div className="cardhead">
              <h2>Worth another look</h2>
              <small>Missed in practice</small>
            </div>
            <ul className="weaklist" aria-label="Concepts to work on">
              {mastery.weak.slice(0, 3).map((w) => {
                const course = study.find((c) => c.id === w.courseId);
                return (
                  <li key={`${w.courseId}/${w.sectionId}/${w.id}`}>
                    <Link href={course ? sectionPath(course, w.sectionId) : '/courses'}>
                      <span>
                        {w.name}
                        <small>{course?.title ?? 'Course'}</small>
                      </span>
                      <ArrowRight size={16} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {stats && (
          <div className="card">
            <div className="cardhead">
              <h2>
                <Timer size={20} className="c-purple" /> Study time
              </h2>
              <small>{weekStudy} min in 7 days</small>
            </div>
            <div className="studybars" role="img" aria-label={`Study minutes for the last 7 days: ${week.map((d) => Math.round(d.studyMin)).join(', ')}`}>
              {week.map((d) => (
                <div key={d.day}>
                  <i style={{ height: `${Math.round((d.studyMin / weekMax) * 100)}%` }} className={d.studyMin > 0 ? 'on' : ''} />
                  <small>{WEEKDAYS[new Date(`${d.day}T12:00:00Z`).getUTCDay()]}</small>
                </div>
              ))}
            </div>
            <p className="muted">
              Counted only while you are in a lesson or a review and actually interacting. {Math.round(stats.totalStudyMin)} minutes in
              total.
            </p>
          </div>
        )}

        <div className="sectionhead">
          <h2>My Courses</h2>
          <Link href="/upload" className="chip-btn">
            <CloudUpload size={18} /> Upload
          </Link>
        </div>
        {generated.length === 0 ? (
          <Link href="/upload" className="uploadcta">
            <span className="uploadcta-ico">
              <CloudUpload size={24} />
            </span>
            <span>
              <b>Add your first course</b>
              <small>Upload a PDF chapter or PowerPoint slides and get lessons with page references.</small>
            </span>
          </Link>
        ) : (
          <div className="stack">
            {generated.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        )}
        {generated.length > 0 && (
          <Link href={coursePath(generated[0])} className="textlink center">
            Open the latest course <ArrowRight size={16} />
          </Link>
        )}

        {samples.length > 0 && (
          <>
            <div className="sectionhead">
              <h2>Sample courses</h2>
              <Link href="/courses" className="textlink">
                View all <ArrowRight size={16} />
              </Link>
            </div>
            <p className="demo-line">Hand-written examples to try the lesson format. They are not built from your files.</p>
            <div className="stack">
              {samples.slice(0, 2).map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
            </div>
          </>
        )}

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
