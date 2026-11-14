'use client';

import { Check, Clock, ListChecks, Lock, ShieldCheck, Star, Trash2, Trophy, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { summarizeCoverage } from '@/lib/learning/coverage';
import { deleteFigures } from '@/lib/learning/figure-store';
import { deleteGeneratedCourse } from '@/lib/learning/generated-store';
import { isGeneratedCourse, sectionPath } from '@/lib/learning/links';
import type { Course } from '@/lib/learning/types';
import { isDemo, sourceName, sourceUnit } from '@/lib/learning/types';
import { courseProgress, sectionStatuses, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { DemoTag, ProgressBar, Sheet } from './ui';

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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fromPdf = isGeneratedCourse(course);
  const report = course.generation?.report;
  const coverage = course.coverage ? summarizeCoverage(course.coverage) : undefined;
  // Planned lessons that have no generated section yet (never requested, or failed).
  const waiting = (course.plan?.lessons ?? [])
    .filter((l) => !ids.includes(l.id))
    .map((lesson) => ({ lesson, state: course.lessonStates?.find((s) => s.lessonId === lesson.id) }));

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const open = (i: number) => {
    if (statuses[i] === 'locked') {
      const need = course.sections[Math.max(activeIndex, 0)];
      setToast(`Finish “${need.title}” to unlock this section.`);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(''), 2800);
      return;
    }
    router.push(sectionPath(course, ids[i]));
  };

  const total = course.sections.length;
  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader backHref="/courses" backLabel="Back to courses" />
        <div className="hero-title">
          <p className="kicker">
            {fromPdf ? course.unitTitle : `${course.code} – ${course.title}`}{' '}
            {isDemo(course.provenance) ? <DemoTag /> : <span className="demotag pdftag">Your {sourceName(course)}</span>}
          </p>
          <h1>{fromPdf ? course.title : <>{course.unitLabel}: <span>{course.unitTitle}</span></>}</h1>
          <div className="progressline">
            <span>
              {progress.done} of {progress.total} sections
            </span>
            <b>{progress.pct}% Complete</b>
          </div>
          <ProgressBar value={progress.pct} label="Course progress" />
        </div>
      </section>

      {fromPdf && report && (
        <div className="pad">
          <div className="note note-info checknote">
            <ShieldCheck size={20} />
            <span>
              <b>
                {report.kept} of {report.checked} generated items matched your {sourceName(course)}.
              </b>{' '}
              {report.dropped > 0 && `${report.dropped} that could not be matched were removed. `}
              This is an automated check of quotes and {sourceUnit(course)} numbers. It reduces mistakes but cannot guarantee
              accuracy, so compare with your course material.
              {course.generation?.provider === 'mock' && ' Built in offline sample mode (no AI).'}
            </span>
          </div>
        </div>
      )}

      {fromPdf && course.coverage && coverage && (
        <div className="pad">
          <div className={`note ${course.coverage.omissions.length ? 'note-warn' : 'note-info'} checknote`}>
            <ListChecks size={20} />
            <span>
              <b>
                {coverage.covered} of {coverage.concepts} planned concepts have an explanation and a practice question.
              </b>{' '}
              {coverage.pagesTaught} of {coverage.pagesWithText} {sourceUnit(course)}s with text are cited by a lesson.
              {course.coverage.omissions.length > 0 ? (
                <details className="omissions">
                  <summary>
                    What was left out ({course.coverage.omissions.length})
                  </summary>
                  <ul>
                    {course.coverage.omissions.map((o, i) => (
                      <li key={`${i}-${o}`}>{o}</li>
                    ))}
                  </ul>
                </details>
              ) : (
                ' Nothing from the plan was left out.'
              )}{' '}
              This compares the lesson plan with the generated lessons. It cannot tell whether the plan itself missed
              something, so check against your course material.
            </span>
          </div>
        </div>
      )}

      {fromPdf && waiting.length > 0 && (
        <div className="pad">
          <div className="card">
            <div className="cardhead">
              <h2>Not generated yet</h2>
              <small>
                {waiting.length} lesson{waiting.length === 1 ? '' : 's'}
              </small>
            </div>
            <ul className="waitlist">
              {waiting.map(({ lesson, state }) => (
                <li key={lesson.id}>
                  <b>{lesson.title}</b> <span className="pill pill-soft">{lesson.difficulty}</span>
                  <small>
                    {state?.status === 'failed'
                      ? `Could not be generated: ${state.reason ?? 'unknown problem'}`
                      : 'Waiting to be generated.'}
                  </small>
                </li>
              ))}
            </ul>
            <p className="muted">
              To generate {waiting.length === 1 ? 'it' : 'them'}, open Upload, choose the same file again and press
              “Generate the remaining lessons”. Your finished lessons and progress are kept.
            </p>
            <Link href="/upload" className="textlink">
              Go to Upload
            </Link>
          </div>
        </div>
      )}

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
                    {course.plan && <>{s.difficulty} • </>}
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
          <span>
            {progress.pct === 100
              ? waiting.length > 0
                ? 'All generated lessons are done. Some planned lessons are still waiting.'
                : 'Course complete. Nice work, Lion!'
              : `Finish all ${total} sections to complete the course`}
          </span>
        </div>
      </section>

      {fromPdf && (
        <div className="pad">
          <button type="button" className="textlink danger center" onClick={() => setConfirmRemove(true)}>
            <Trash2 size={16} /> Remove this course
          </button>
        </div>
      )}
      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove this course?">
        <p>
          The lessons generated from this file will be deleted from this device. Your XP stays. To get them back you
          would need to upload the file again.
        </p>
        <div className="actionbar inline">
          <button type="button" className="btn btn-outline" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => {
              if (course.provenance.kind === 'pdf') void deleteFigures(course.provenance.documentId);
              deleteGeneratedCourse(course.id);
              router.push('/courses');
            }}
          >
            Remove
          </button>
        </div>
      </Sheet>

      <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
        <Lock size={16} /> {toast}
      </div>
    </main>
  );
}
