import type { ExtractedPage } from './contracts.ts';
import type { SourceCitation } from './types.ts';

/**
 * Grounding verification: checks generated content against the PDF text.
 *
 * Two automated checks run on every generated item:
 *   1. Each citation's quote must actually appear on a page of the PDF
 *      (exactly, or with at most a few differing words).
 *   2. Most of the item's key words must appear on the pages it cites.
 *
 * These are lexical checks. They catch invented quotes, wrong page numbers and
 * claims unrelated to the cited text, but they cannot prove that a statement
 * is correct. Content that passes can still be wrong or misleading, so the UI
 * must never present this as a guarantee of accuracy.
 */

export interface RawCitation {
  page: number;
  quote: string;
}

export const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_TOKENS = 80;
const CLOSE_MATCH_RATIO = 0.9;
const CLAIM_SUPPORT_RATIO = 0.6;

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/­/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STOPWORDS = new Set(
  `about above after again against also although always among another because been before being below between both
  cannot could does doing during each either every from further have having here into itself just more most much must
  only other over same should some such than that their theirs them then there these they this those through under
  until very what when where which while will with within without would your yours called known means used using
  uses make makes made many often show shows shown`.split(/\s+/),
);

/** Crude stemmer so "logs"/"logging"/"logged" compare equal. */
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/u, '') : w.replace(/s$/u, ''));

export function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .map(stem);
}

interface IndexedPage {
  page: number;
  norm: string;
  tokens: string[];
  stems: Set<string>;
}

export class PageIndex {
  private pages = new Map<number, IndexedPage>();

  constructor(pages: ExtractedPage[]) {
    for (const p of pages) {
      const norm = normalizeText(p.text);
      const tokens = norm.split(' ');
      this.pages.set(p.page, { page: p.page, norm, tokens, stems: new Set(tokens.map(stem)) });
    }
  }

  get(page: number) {
    return this.pages.get(page);
  }

  all() {
    return [...this.pages.values()];
  }
}

/** Best share of the quote's words found in any same-length window of the page. */
function bestWindowOverlap(quote: string[], page: string[]): number {
  if (quote.length === 0 || page.length < quote.length) return 0;
  const need = new Map<string, number>();
  for (const t of quote) need.set(t, (need.get(t) ?? 0) + 1);
  let best = 0;
  for (let start = 0; start + quote.length <= page.length; start++) {
    const seen = new Map<string, number>();
    let hit = 0;
    for (let i = start; i < start + quote.length; i++) {
      const t = page[i];
      const want = need.get(t);
      if (!want) continue;
      const have = seen.get(t) ?? 0;
      if (have < want) {
        seen.set(t, have + 1);
        hit++;
      }
    }
    if (hit > best) best = hit;
    if (best === quote.length) break;
  }
  return best / quote.length;
}

export type CitationCheck =
  | { ok: true; page: number; excerpt: string; support: 'exact' | 'close' }
  | { ok: false; reason: string };

/**
 * Confirms a quote appears in the PDF. If it is found word for word on a
 * different page than cited, the page number is corrected.
 */
export function checkCitation(citation: RawCitation, index: PageIndex): CitationCheck {
  const quote = normalizeText(citation.quote ?? '');
  if (quote.length < MIN_QUOTE_CHARS) return { ok: false, reason: 'quote is too short to verify' };
  const excerpt = citation.quote.trim().replace(/\s+/g, ' ').slice(0, 320);

  const cited = index.get(citation.page);
  if (cited?.norm.includes(quote)) return { ok: true, page: cited.page, excerpt, support: 'exact' };
  for (const p of index.all()) {
    if (p.norm.includes(quote)) return { ok: true, page: p.page, excerpt, support: 'exact' };
  }
  if (!cited) return { ok: false, reason: `page ${citation.page} is not in the document` };

  const tokens = quote.split(' ').slice(0, MAX_QUOTE_TOKENS);
  if (tokens.length >= 5 && bestWindowOverlap(tokens, cited.tokens) >= CLOSE_MATCH_RATIO) {
    return { ok: true, page: cited.page, excerpt, support: 'close' };
  }
  return { ok: false, reason: `quote not found on page ${citation.page}` };
}

/** Share of the claim's key words that appear on the given pages. */
export function claimSupport(claim: string, pages: number[], index: PageIndex): number {
  const words = [...new Set(contentWords(claim))];
  if (words.length === 0) return 1;
  const found = words.filter((w) => pages.some((n) => index.get(n)?.stems.has(w)));
  return found.length / words.length;
}

export type ItemCheck =
  | { ok: true; citations: SourceCitation[] }
  | { ok: false; reason: string };

/**
 * Verifies one generated item (a note, question, key point or flashcard).
 * `claim` is the text whose key words must be covered by the cited pages.
 */
export function verifyItem(
  claim: string,
  citations: RawCitation[] | undefined,
  index: PageIndex,
  documentId: string,
): ItemCheck {
  if (!citations?.length) return { ok: false, reason: 'no citation' };
  const good: SourceCitation[] = [];
  let lastReason = 'no valid citation';
  for (const c of citations.slice(0, 3)) {
    const check = checkCitation(c, index);
    if (check.ok) good.push({ documentId, page: check.page, excerpt: check.excerpt, support: check.support });
    else lastReason = check.reason;
  }
  if (good.length === 0) return { ok: false, reason: lastReason };
  const ratio = claimSupport(claim, good.map((c) => c.page), index);
  if (ratio < CLAIM_SUPPORT_RATIO) {
    return { ok: false, reason: `only ${Math.round(ratio * 100)}% of key terms appear on the cited page` };
  }
  return { ok: true, citations: good };
}
