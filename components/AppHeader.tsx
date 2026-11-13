'use client';

import { ArrowLeft, Bell, Flame, Info, Sparkles, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { initialsOf, useProgress } from '@/lib/progress/store';
import { LionMascot } from './LionMascot';
import { DemoTag, Sheet } from './ui';

const NOTIF_KEY = 'una-learning:notifications-seen';

/** Sample notifications. Replace with real events once accounts exist. */
const DEMO_NOTIFICATIONS = [
  { icon: Flame, title: 'Keep your streak alive', body: 'Finish one section today to extend your streak.', href: '/courses' },
  { icon: Sparkles, title: 'New section unlocked', body: 'Linux System Auditing Commands is ready in CIS 344.', href: '/courses/cis-344' },
  { icon: Upload, title: 'PDF lessons are coming', body: 'Uploading is a preview for now. Nothing is processed yet.', href: '/upload' },
];

export function AppHeader({ backHref, backLabel = 'Back' }: { backHref?: string; backLabel?: string }) {
  const { state } = useProgress();
  const [sheet, setSheet] = useState<'none' | 'about' | 'notifications'>('none');
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    try {
      setUnseen(window.localStorage.getItem(NOTIF_KEY) !== '1');
    } catch {
      setUnseen(true);
    }
  }, []);

  const openNotifications = () => {
    setSheet('notifications');
    setUnseen(false);
    try {
      window.localStorage.setItem(NOTIF_KEY, '1');
    } catch {
      /* ignore */
    }
  };
  const close = () => setSheet('none');

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
      <button type="button" className="iconbtn glass" onClick={openNotifications} aria-label="Notifications">
        <Bell size={20} />
        {unseen && <i className="dot" aria-hidden="true" />}
      </button>
      <Link href="/profile" className="avatar" aria-label="Your profile">
        {initialsOf(state.name)}
      </Link>

      <Sheet open={sheet === 'about'} onClose={close} title="About UNA Learning">
        <p>
          UNA Learning is an <strong>independent student project</strong> built for fellow students. It is not an
          official University of North Alabama application and is not affiliated with or endorsed by the university.
        </p>
        <p>
          All courses, lessons, quizzes and statistics in this prototype are <strong>demo data</strong>. Nothing was
          generated from a real course PDF, and nothing you do here leaves your device.
        </p>
        <button type="button" className="btn btn-gold" onClick={close}>
          Got it
        </button>
      </Sheet>

      <Sheet open={sheet === 'notifications'} onClose={close} title="Notifications">
        <p className="sheet-note">
          <DemoTag /> Sample notifications
        </p>
        <ul className="notif-list">
          {DEMO_NOTIFICATIONS.map(({ icon: Icon, title, body, href }) => (
            <li key={title}>
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
      </Sheet>
    </header>
  );
}
