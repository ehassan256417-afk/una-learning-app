'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { num } from './format';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="ow-loading" role="status" aria-live="polite">
      <span className="ow-spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ow-skel-wrap" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ow-skel" style={{ width: `${100 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ message, forbidden, onRetry }: { message: string; forbidden?: boolean; onRetry?: () => void }) {
  return (
    <div className="ow-error" role="alert">
      <p>{forbidden ? 'This area is for the site owner.' : message}</p>
      {onRetry && !forbidden && (
        <button type="button" className="ow-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="ow-empty">{children}</p>;
}

export function Card({ title, note, actions, children, className }: { title?: string; note?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ow-card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="ow-card-head">
          <div>
            {title && <h3>{title}</h3>}
            {note && <p className="ow-note">{note}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info'; children: ReactNode }) {
  return <span className={`ow-badge ow-badge-${tone}`}>{children}</span>;
}

export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ow-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Percent change versus the previous period. */
export function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="ow-trend ow-trend-flat">no change</span>;
  if (previous === 0) return <span className="ow-trend ow-trend-up">new (none in the previous period)</span>;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return <span className="ow-trend ow-trend-flat">no change vs previous</span>;
  const up = change > 0;
  return (
    <span className={`ow-trend ${up ? 'ow-trend-up' : 'ow-trend-down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {up ? 'Up' : 'Down'} {Math.abs(Math.round(change))}% vs previous
    </span>
  );
}

export function Kpi({ label, value, hint, trend }: { label: string; value: string; hint?: string; trend?: ReactNode }) {
  return (
    <div className="ow-kpi">
      <div className="ow-kpi-label">{label}</div>
      <div className="ow-kpi-value">{value}</div>
      {trend && <div className="ow-kpi-trend">{trend}</div>}
      {hint && <div className="ow-kpi-hint">{hint}</div>}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const tone = ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : 'good';
  return (
    <div>
      <div className="ow-meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-label={label}>
        <div className={`ow-meter-fill ow-meter-${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="ow-note">
        {num(value)} of {num(max)} used ({max > 0 ? Math.round(ratio * 100) : 0}%)
      </p>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="ow-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="ow-note">{hint}</p>}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openDialogs: HTMLElement[] = [];

/** Modal dialog: focus moves in, Tab stays inside, Escape closes, focus returns on close. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) openDialogs.push(node);
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Only the dialog on top reacts when dialogs are stacked.
      if (openDialogs[openDialogs.length - 1] !== node) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const at = node ? openDialogs.indexOf(node) : -1;
      if (at >= 0) openDialogs.splice(at, 1);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="ow-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`ow-dialog ${wide ? 'ow-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the owner must type this exact text before the button works. */
  typeToConfirm?: string;
  /** Optional free-text field (for example a reason). */
  inputLabel?: string;
  inputPlaceholder?: string;
  onConfirm: (input: string) => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog(props: ConfirmProps) {
  const { title, body, confirmLabel, danger, typeToConfirm, inputLabel, inputPlaceholder, onConfirm, onClose } = props;
  const [typed, setTyped] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typedId = useId();
  const inputId = useId();
  const matches = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(input.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={busy ? () => undefined : onClose}>
      <div className="ow-dialog-body">{body}</div>
      {inputLabel && (
        <div className="ow-field">
          <label htmlFor={inputId}>{inputLabel}</label>
          <input id={inputId} className="ow-input" value={input} maxLength={200} placeholder={inputPlaceholder} onChange={(e) => setInput(e.target.value)} />
        </div>
      )}
      {typeToConfirm && (
        <div className="ow-field">
          <label htmlFor={typedId}>
            Type <strong>{typeToConfirm}</strong> to confirm
          </label>
          <input id={typedId} data-autofocus className="ow-input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
      {error && (
        <p className="ow-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="ow-dialog-actions">
        <button type="button" className="ow-btn" onClick={onClose} disabled={busy} data-autofocus={typeToConfirm ? undefined : ''}>
          Cancel
        </button>
        <button type="button" className={`ow-btn ${danger ? 'ow-btn-danger' : 'ow-btn-primary'}`} onClick={() => void run()} disabled={busy || !matches}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className="ow-btn ow-btn-sm"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setState('done'))
          .catch(() => setState('failed'));
      }}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
