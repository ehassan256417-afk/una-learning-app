import type { BudgetUse } from '../lib/learning/types.ts';

/**
 * Per-course spending limits for the AI provider.
 *
 * Every AI request is checked BEFORE it is made, against the worst case it
 * could cost (its prompt plus its full output allowance). A request that does
 * not fit is refused without calling the provider, so a course can never
 * exceed its budget. Counters live in memory and expire with the entry.
 */

export interface BudgetLimits {
  /** AI requests allowed for one course (the plan plus its lessons). */
  maxRequests: number;
  /** Prompt plus output tokens allowed for one course. */
  maxTokens: number;
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

interface Entry {
  requests: number;
  tokens: number;
  /** Tokens set aside for requests that are still running. */
  reserved: number;
  expiresAt: number;
}

export class CourseBudgets {
  private entries = new Map<string, Entry>();
  private limits: BudgetLimits;
  private ttlMs: number;
  private now: () => number;

  constructor(limits: BudgetLimits, ttlMs = 24 * 60 * 60_000, now: () => number = Date.now) {
    this.limits = limits;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  private entry(key: string): Entry {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || e.expiresAt <= t) {
      e = { requests: 0, tokens: 0, reserved: 0, expiresAt: t + this.ttlMs };
      this.entries.set(key, e);
      if (this.entries.size > 2000) {
        for (const [k, v] of this.entries) if (v.expiresAt <= t) this.entries.delete(k);
      }
      // Hard cap on memory: beyond it the oldest idle entries go first.
      for (const [k, v] of this.entries) {
        if (this.entries.size <= 5000) break;
        if (k !== key && v.reserved === 0) this.entries.delete(k);
      }
    }
    return e;
  }

  use(key: string): BudgetUse {
    const e = this.entry(key);
    return {
      requests: e.requests,
      maxRequests: this.limits.maxRequests,
      tokens: e.tokens + e.reserved,
      maxTokens: this.limits.maxTokens,
    };
  }

  /**
   * Claims one request and its worst-case tokens, or throws without changing
   * anything. Call the returned function exactly once with the tokens really
   * used (0 if the provider never reported any).
   */
  begin(key: string, worstCaseTokens: number): (actualTokens: number) => void {
    const e = this.entry(key);
    if (e.requests >= this.limits.maxRequests) {
      throw new BudgetError(
        `This course has used all ${this.limits.maxRequests} AI requests in its budget. The lessons already created are kept.`,
      );
    }
    if (e.tokens + e.reserved + worstCaseTokens > this.limits.maxTokens) {
      throw new BudgetError(
        `This course has reached its AI token budget (${this.limits.maxTokens.toLocaleString('en-US')} tokens). The lessons already created are kept.`,
      );
    }
    e.requests++;
    e.reserved += worstCaseTokens;
    let settled = false;
    return (actualTokens: number) => {
      if (settled) return;
      settled = true;
      e.reserved = Math.max(0, e.reserved - worstCaseTokens);
      // A count that is not a usable number is charged as the worst case, never as zero or NaN.
      e.tokens += Number.isFinite(actualTokens) ? Math.max(0, Math.round(actualTokens)) : worstCaseTokens;
    };
  }
}

/** Rough token count for text the provider has not measured yet. Deliberately on the high side. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 3);
