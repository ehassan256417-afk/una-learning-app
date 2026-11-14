'use client';

import { ArrowLeft, Bell, CloudUpload, Info, Repeat, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/lib/account/session';
import { useGeneratedCourses, useStudyCourses } from '@/lib/learning/generated-store';
import { coursePath } from '@/lib/learning/links';
import { dayIndex, dueItems } from '@/lib/progress/mastery';
import { initialsOf, useProgress } from '@/lib/progress/store';
import { LionMascot } from './LionMascot';
import { Sheet } from './ui';

interface Notice {
  icon: typeof Bell;
  title: string;
  body: string;
  href: string;
}

/** Notifications are worked out from the student's own data: reviews due, lessons waiting, today's goal. */
function useNotices(): Notice[] {
  const { state, ready } = useProgress();
  const { config } = useSession();
  const { courses } = useGeneratedCourses();
  const study = useStudyCourses(config.features.sampleCourses);
  if (!ready) return [];
  const notices: Notice[] = [];
  const due = config.features.spacedReview ? dueItems(study, state.review, dayIndex(new Date())).length : 0;
  if (due > 0) {
    notices.push({ icon: Repeat, title: `${due} item${due === 1 ? '' : 's'} due for review`, body: 'A short recall session keeps them in memory.', href: '/review' });
  }
  for (const c of courses) {
    const waiting = (c.plan?.lessons.length ?? c.sections.length) - c.sections.length;
    if (waiting > 0) {
      notices.push({
        icon: Sparkles,
        title: `${waiting} lesson${waiting === 1 ? '' : 's'} not generated yet`,
        body: `${c.title}: open Upload with the same file to finish the course.`,
        href: coursePath(c),
      });
    }
  }
  if (state.todayXp < config.learning.dailyGoalXp && state.xp > 0) {
    notices.push({
      icon: Target,
      title: "Today's goal is still open",
      body: `${config.learning.dailyGoalXp - state.todayXp} XP to go. One lesson usually covers it.`,
      href: '/courses',
    });
  }
  if (courses.length === 0) {
    notices.push({ icon: CloudUpload, title: 'Add your first course', body: 'Upload a PDF or slides to build lessons from your own material.', href: '/upload' });
  }
  return notices;
}

export function AppHeader({ backHref, backLabel = 'Back' }: { backHref?: string; backLabel?: string }) {
  const { state } = useProgress();
  const { user } = useSession();
  const notices = useNotices();
  const [sheet, setSheet] = useState<'none' | 'about' | 'notifications'>('none');
  const close = () => setSheet('none');
  const urgent = notices.some((n) => n.href === '/review');

  return (
    <header className="topbar">
      {backHref && (
        <Link href={backHref} className="iconbtn" aria-label={backLabel}>
          <ArrowLeft size={22} />
        </Link>
      )}
      <Link href="/" className="brandmark" aria-label="UNA Learning home">
        <LionMascot size={backHref ? 40 : 46} />
      </Link>
      <div className="brand">
        <Link href="/" className="brand-name">
          UNA <em>Learning</em>
        </Link>
        <button type="button" className="brand-sub" onClick={() => setSheet('about')}>
          Independent student project <Info size={12} aria-hidden="true" />
          <span className="sr-only">About this project</span>
        </button>
      </div>
      <button type="button" className="iconbtn glass" onClick={() => setSheet('notifications')} aria-label={`Notifications (${notices.length})`}>
        <Bell size={20} />
        {urgent && <i className="dot" aria-hidden="true" />}
      </button>
      <Link href="/profile" className="avatar" aria-label="Your profile">
        {initialsOf(state.name || user?.name || '')}
      </Link>

      <Sheet open={sheet === 'about'} onClose={close} title="About UNA Learning">
        <p>
          UNA Learning is an <strong>independent student project</strong> built for fellow students. It is not an
          official University of North Alabama application and is not affiliated with or endorsed by the university.
        </p>
        <p>
          Lessons are written by AI from the text of the files you upload and checked against that text automatically.
          The check reduces mistakes but cannot rule them out. Courses marked <strong>Sample</strong> are hand-written
          examples.
        </p>
        <button type="button" className="btn btn-gold" onClick={close}>
          Got it
        </button>
      </Sheet>

      <Sheet open={sheet === 'notifications'} onClose={close} title="Notifications">
        {notices.length === 0 ? (
          <p className="sheet-note">You are all caught up. Reviews that come due will show here.</p>
        ) : (
          <ul className="notif-list">
            {notices.map(({ icon: Icon, title, body, href }) => (
              <li key={title + href}>
                <Link href={href} onClick={close}>
                  <span className="notif-ico">
                    <Icon size={18} />
                  </span>
                  <span>
                    <b>{title}</b>
                    <small>{body}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </header>
  );
}
