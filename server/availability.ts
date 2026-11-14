/**
 * Remembers when an AI provider last said it was unavailable (a 5xx answer).
 *
 * While a provider is paused, requests are refused before the provider is
 * called, so an outage is not hammered and a student who keeps pressing the
 * button does not use up their limits. Nothing here ever sends a request: the
 * next attempt is always one the student makes, after the pause is over.
 */

/** Pause after the first, second, third and later outage answers in a row, in seconds. */
const STEPS_SEC = [30, 60, 120, 300];
/** A provider's own Retry-After is followed up to this many seconds. */
const MAX_WAIT_SEC = 900;
/** An outage this long after the previous pause ended counts as a new one. */
const QUIET_MS = 30 * 60_000;

interface Pause {
  until: number;
  strikes: number;
}

export class ProviderAvailability {
  private pauses = new Map<string, Pause>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Seconds until the provider may be asked again; 0 when it may be asked now. */
  waitSec(key: string): number {
    const pause = this.pauses.get(key);
    return pause ? Math.max(0, Math.ceil((pause.until - this.now()) / 1000)) : 0;
  }

  /** Records an outage answer and returns how many seconds the provider is now paused for. */
  failed(key: string, retryAfterSec?: number): number {
    const t = this.now();
    const before = this.pauses.get(key);
    // Requests that were already running when the pause began do not lengthen it.
    if (before && before.until > t) return this.waitSec(key);
    const strikes = before && t - before.until < QUIET_MS ? before.strikes + 1 : 1;
    const step = STEPS_SEC[Math.min(strikes, STEPS_SEC.length) - 1];
    const asked = typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) ? retryAfterSec : 0;
    const wait = Math.min(MAX_WAIT_SEC, Math.max(step, Math.ceil(asked)));
    this.pauses.set(key, { until: t + wait * 1000, strikes });
    return wait;
  }

  /** The provider answered, so the next outage starts from the short pause again. */
  succeeded(key: string) {
    this.pauses.delete(key);
  }
}
