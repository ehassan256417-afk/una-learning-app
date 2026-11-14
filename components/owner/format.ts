import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/account/client';

export const nf = new Intl.NumberFormat('en-US');
export const num = (n: number): string => nf.format(Math.round(n));
export const num1 = (n: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);

export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${num1(n / 1_000_000)}M`;
  if (Math.abs(n) >= 10_000) return `${num1(n / 1000)}k`;
  return num(n);
}

export function minutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0 min';
  if (min < 60) return `${num1(min)} min`;
  const h = min / 60;
  if (h < 48) return `${num1(h)} h`;
  return `${num1(h / 24)} days`;
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function dateOnly(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${num(n)} B`;
  if (n < 1024 * 1024) return `${num1(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${num1(n / (1024 * 1024))} MB`;
  return `${num1(n / (1024 * 1024 * 1024))} GB`;
}

export function usd(n: number): string {
  return n < 0.01 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`;
}

export function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  const v = (part / whole) * 100;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;
}

export const kindLabel = (kind: string): string =>
  kind === 'plan' ? 'Planning a course' : kind === 'lesson' ? 'Writing one lesson' : kind === 'course' ? 'Whole course (legacy)' : kind;

export const sourceLabel = (kind: string): string => (kind === 'pptx' ? 'PowerPoint' : kind === 'pdf' ? 'PDF' : kind || 'Unknown');

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return 'This area is for the site owner.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export const isForbidden = (err: unknown): boolean => err instanceof ApiError && (err.status === 401 || err.status === 403);

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  reload: () => void;
  setData: (next: T | null) => void;
}

/** Loads `path` (null = do not load), reloading when the path or `tick` changes. Stale responses are ignored. */
export function useLoad<T>(path: string | null, tick = 0): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [local, setLocal] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: controller.signal })
      .then((res) => {
        if (mine !== seq.current) return;
        setData(res);
        setForbidden(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current || controller.signal.aborted) return;
        setError(errorText(err));
        setForbidden(isForbidden(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, tick, local]);

  const reload = useCallback(() => setLocal((n) => n + 1), []);
  return { data, loading, error, forbidden, reload, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
