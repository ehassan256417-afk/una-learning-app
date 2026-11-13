'use client';

import { BookOpen, Flame, Layers, Lock, Star, Target, Trophy, X } from 'lucide-react';
import { Fragment, useEffect } from 'react';
import type { Badge, BadgeIcon } from '@/lib/progress/badges';

export function ProgressBar({
  value,
  tone = 'gold',
  label,
}: {
  value: number;
  tone?: 'gold' | 'purple' | 'green';
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar bar-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Small pill that marks sample content. Shown wherever demo data appears. */
export function DemoTag({ children = 'Demo' }: { children?: React.ReactNode }) {
  return <span className="demotag">{children}</span>;
}

/**
 * Renders `inline code` in backticks and highlights one key term.
 * Content is plain text from the learning engine, never HTML.
 */
export function RichText({ text, highlight }: { text: string; highlight?: string }) {
  const parts = text.split('`');
  let highlighted = false;
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) return <code key={i}>{part}</code>;
        if (highlight && !highlighted) {
          const at = part.toLowerCase().indexOf(highlight.toLowerCase());
          if (at >= 0) {
            highlighted = true;
            return (
              <Fragment key={i}>
                {part.slice(0, at)}
                <mark>{part.slice(at, at + highlight.length)}</mark>
                {part.slice(at + highlight.length)}
              </Fragment>
            );
          }
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

const BADGE_ICONS: Record<BadgeIcon, typeof BookOpen> = {
  book: BookOpen,
  flame: Flame,
  trophy: Trophy,
  layers: Layers,
  star: Star,
  target: Target,
};

export function BadgeMedal({ badge, showHint = false }: { badge: Badge; showHint?: boolean }) {
  const Icon = BADGE_ICONS[badge.icon];
  return (
    <div className={`badge ${badge.earned ? 'earned' : 'locked'}`}>
      <span className="badge-hex" aria-hidden="true">
        <span className="badge-hex-in">{badge.earned ? <Icon size={24} /> : <Lock size={20} />}</span>
      </span>
      <b>{badge.label}</b>
      {showHint && <small>{badge.earned ? 'Earned' : badge.hint}</small>}
      <span className="sr-only">{badge.earned ? 'earned' : 'not earned yet'}</span>
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn subtle" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
