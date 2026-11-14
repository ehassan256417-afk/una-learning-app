'use client';

import { API_URL, authHeaders, readSession } from './client';
import type { ActivityBatch, ActivityEventType } from './contracts';
import { isStudyRoute, routeName } from './route';

/**
 * Measures real use of the site for the owner dashboard and the student's own
 * study statistics.
 *
 * What counts as active time: the tab is visible AND there was keyboard,
 * pointer, touch or scroll input in the last minute. A tab left open in the
 * background, or a page nobody touches, adds nothing. Study time is active
 * time spent in a lesson or a review session.
 *
 * What is sent: a random browser id, a random visit id, the kind of page
 * (never course ids or query strings), and counts. No names, no document text.
 * Visitors who are not signed in and whose browser asks not to be tracked
 * (Do Not Track / Global Privacy Control) are not measured at all. The owner's
 * own use is not measured either, so it does not distort the numbers.
 */

const VISITOR_KEY = 'una-learning:visitor';
const VISIT_KEY = 'una-learning:visit';
const TICK_MS = 5_000;
const FLUSH_MS = 30_000;
const IDLE_MS = 60_000;
const VISIT_GAP_MS = 30 * 60_000;

type QueuedEvent = ActivityBatch['events'][number];

let started = false;
let queue: QueuedEvent[] = [];
let activeMs = 0;
let studyMs = 0;
let lastInput = 0;
let route = '';
let lastFlush = 0;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export function visitorId(): string {
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,40}$/.test(id)) {
      id = randomId();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** One visit lasts until half an hour passes with no activity. */
function visitId(): string {
  const now = Date.now();
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(VISIT_KEY) ?? 'null') as { id: string; at: number } | null;
    const id = saved && now - saved.at < VISIT_GAP_MS ? saved.id : randomId();
    window.sessionStorage.setItem(VISIT_KEY, JSON.stringify({ id, at: now }));
    return id;
  } catch {
    return '';
  }
}

function allowed(): boolean {
  if (!API_URL) return false;
  const session = readSession();
  if (session?.user.role === 'owner') return false;
  if (session) return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack !== '1' && nav.globalPrivacyControl !== true;
}

function referrerHost(): string {
  try {
    if (!document.referrer) return '';
    const host = new URL(document.referrer).host;
    return host === window.location.host ? '' : host.slice(0, 80);
  } catch {
    return '';
  }
}

function flush(closing = false) {
  if (queue.length === 0 && activeMs === 0) return;
  if (!allowed()) {
    queue = [];
    activeMs = 0;
    studyMs = 0;
    return;
  }
  const visitor = visitorId();
  const visit = visitId();
  if (!visitor || !visit) return;
  const batch: ActivityBatch = { visitorId: visitor, visitId: visit, referrer: referrerHost(), activeMs, studyMs, events: queue.slice(0, 60) };
  queue = [];
  activeMs = 0;
  studyMs = 0;
  lastFlush = Date.now();
  // Measurement must never get in the way: failures are dropped silently.
  void fetch(`${API_URL}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(batch),
    keepalive: closing,
  }).catch(() => undefined);
}

function tick() {
  const now = Date.now();
  if (document.visibilityState === 'visible' && now - lastInput < IDLE_MS) {
    activeMs += TICK_MS;
    if (isStudyRoute(route)) studyMs += TICK_MS;
  }
  if (now - lastFlush >= FLUSH_MS) flush();
}

/** Starts measuring. Safe to call more than once. */
export function startTracker() {
  if (started || typeof window === 'undefined') return;
  started = true;
  lastFlush = Date.now();
  const input = () => {
    lastInput = Date.now();
  };
  for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) window.addEventListener(name, input, { passive: true });
  window.addEventListener('scroll', input, { passive: true, capture: true });
  window.setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}

/** Records that a page was opened. */
export function trackPage(pathname: string, search: string) {
  const next = routeName(pathname, search, process.env.NEXT_PUBLIC_BASE_PATH ?? '');
  if (next === route) return;
  queue.push({ type: 'page_view', path: next, ...(route ? { prev: route } : {}) });
  route = next;
  lastInput = Date.now();
  // Sent shortly after, so a quick visit of one page is still counted.
  window.setTimeout(() => flush(), 1500);
}

/** Records something the student did (started a lesson, finished a review, ...). */
export function track(type: Exclude<ActivityEventType, 'page_view'>, value = 0) {
  if (typeof window === 'undefined') return;
  queue.push({ type, path: route, value });
  window.setTimeout(() => flush(), 500);
}
