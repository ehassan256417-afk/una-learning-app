'use client';

import {
  BarChart3,
  BookOpen,
  Check,
  ClipboardCheck,
  FileText,
  Flame,
  Info,
  Layers,
  Lock,
  PenLine,
  Play,
  RotateCcw,
  ShieldCheck,
  Star,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Course, Section } from '@/lib/learning/types';
import { isDemo } from '@/lib/learning/types';
import { sectionStatuses, useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { LionMascot } from './LionMascot';
import { DemoTag, ProgressBar, RichText, Sheet } from './ui';

function Illustration({ courseId }: { courseId: string }) {
  const Icon = courseId.startsWith('en') ? PenLine : ShieldCheck;
  return (
    <div className="banner" aria-hidden="true">
      <span className="banner-star s1" />
      <span className="banner-star s2" />
      <span className="banner-star s3" />
      <div className="banner-window">
        <div className="banner-dots">
          <i />
          <i />
          <i />
        </div>
        <div className="banner-prompt">
          <b>&gt;_</b>
          <span />
        </div>
        <div className="banner-lines">
          <span />
          <span />
        </div>
        <div className="banner-shield">
          <Icon size={26} strokeWidth={2.4} />
        </div>
      </div>
      <LionMascot variant="full" size={136} className="banner-lion" />
    </div>
  );
}

export function PreLessonView({ course, section, index }: { course: Course; section: Section; index: number }) {
  const { state } = useProgress();
  const [sheet, setSheet] = useState<'none' | 'keypoints' | 'source'>('none');
  const ids = course.sections.map((s) => s.id);
  const status = sectionStatuses(course.id, ids, state)[index];
  const total = course.sections.length;
  const pct = Math.round((index / total) * 100);
  const lessonHref = `/courses/${course.id}/${section.id}/lesson`;
  const demo = isDemo(section.provenance);

  return (
    <main className="screen with-actionbar">
      <section className="hero hero-prelesson">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader backHref={`/courses/${course.id}`} backLabel="Back to learning path" />
        <div className="hero-title">
          <p className="kicker">
            {course.code} – {course.title}
          </p>
          <div className="progressline">
            <span>
              Section {index + 1} of {total}
            </span>
            <b>{pct}% Complete</b>
          </div>
          <ProgressBar value={pct} label="Position in course" />
          <h1>
            <span>Section {index + 1}:</span> {section.title}
          </h1>
        </div>
        <Illustration courseId={course.id} />
      </section>

      <div className="pad prelesson-body">
        <div className="ministats">
          <div>
            <Timer size={22} className="c-purple" />
            <span>
              <b>{section.estMinutes}</b>
              <small>Est. Time</small>
            </span>
          </div>
          <div>
            <Star size={22} className="c-gold" fill="currentColor" />
            <span>
              <b>+{section.xpReward} XP</b>
              <small>Reward</small>
            </span>
          </div>
          <div>
            <BarChart3 size={22} className="c-green" />
            <span>
              <b>{section.difficulty}</b>
              <small>Difficulty</small>
            </span>
          </div>
          <div>
            <Flame size={22} className="c-fire" fill="currentColor" />
            <span>
              <b>{state.streak} Day</b>
              <small>Streak</small>
            </span>
          </div>
        </div>

        <div className="card">
          <h2>What you’ll learn</h2>
          <ul className="checklist">
            {section.objectives.map((o) => (
              <li key={o}>
                <span className="tick">
                  <Check size={14} strokeWidth={3.4} />
                </span>
                {o}
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="cardhead">
            <h2>Challenge Preview</h2>
            <small>3 activities • ~{section.estMinutes}</small>
          </div>
          <div className="tiles">
            <div>
              <BookOpen size={26} className="c-purple" />
              <span>
                <b>Notes</b>
                <small>
                  {section.notes.length} key concept{section.notes.length === 1 ? '' : 's'}
                </small>
              </span>
            </div>
            <div>
              <ClipboardCheck size={26} className="c-purple" />
              <span>
                <b>Quiz</b>
                <small>{section.questions.length} questions</small>
              </span>
            </div>
            <div>
              <Layers size={26} className="c-green" />
              <span>
                <b>Flashcards</b>
                <small>{section.flashcards.length} key terms</small>
              </span>
            </div>
          </div>
        </div>

        <button type="button" className="sourcecard" onClick={() => setSheet('source')}>
          <span className="pdfico pdfico-purple" aria-hidden="true">
            <FileText size={20} />
            <b>PDF</b>
          </span>
          <span>
            <b>Source {demo && <DemoTag />}</b>
            <small>
              {demo
                ? 'Sample lesson. Not generated from an uploaded PDF yet.'
                : `Generated from your uploaded course PDF (${course.code}).`}
            </small>
          </span>
          <Info size={20} className="info" aria-hidden="true" />
        </button>
      </div>

      <div className="actionbar">
        <button type="button" className="btn btn-outline" onClick={() => setSheet('keypoints')}>
          <BookOpen size={18} /> Review Key Points
        </button>
        {status === 'locked' ? (
          <Link href={`/courses/${course.id}`} className="btn btn-locked">
            <Lock size={18} /> Locked
          </Link>
        ) : (
          <Link href={lessonHref} className="btn btn-gold">
            {status === 'done' ? <RotateCcw size={18} /> : <Play size={18} fill="currentColor" />}
            {status === 'done' ? 'Review Lesson' : 'Start Lesson'}
          </Link>
        )}
      </div>

      <Sheet open={sheet === 'keypoints'} onClose={() => setSheet('none')} title="Key points">
        {demo && (
          <p className="sheet-note">
            <DemoTag /> Sample key points
          </p>
        )}
        <ol className="keypoints">
          {section.keyPoints.map((k, i) => (
            <li key={k}>
              <span>{i + 1}</span>
              <p>
                <RichText text={k} />
              </p>
            </li>
          ))}
        </ol>
        {status !== 'locked' && (
          <Link href={lessonHref} className="btn btn-gold">
            <Play size={18} fill="currentColor" /> {status === 'done' ? 'Review Lesson' : 'Start Lesson'}
          </Link>
        )}
      </Sheet>

      <Sheet open={sheet === 'source'} onClose={() => setSheet('none')} title="Where this lesson comes from">
        <p>
          {demo ? (
            <>
              This section is <strong>demo content</strong> written by hand for the prototype. It was not extracted
              from, or checked against, a real course PDF.
            </>
          ) : (
            <>This section was generated from your uploaded PDF. Each item links to the page it came from.</>
          )}
        </p>
        <p>
          When the PDF learning engine is added, every note and question will cite the page and excerpt that supports
          it, and anything without a supporting excerpt will be left out.
        </p>
        <button type="button" className="btn btn-gold" onClick={() => setSheet('none')}>
          Got it
        </button>
      </Sheet>
    </main>
  );
}
