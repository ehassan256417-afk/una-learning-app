/**
 * Runs adaptive generation (one planning request, then one request per lesson)
 * against the live ZRO API and writes a report for manual review.
 * THIS MAKES REAL API CALLS; run it only on purpose.
 *
 *   node scripts/validate-adaptive.ts [biology|history|computing]
 *
 * VALIDATE_MAX_CALLS (default 4) is a hard limit on requests for the whole run:
 * once reached, remaining lessons are skipped and never reach the network.
 * The key is read from the git-ignored .env and is never printed or stored.
 * Reports go to .claude/validation/, which is git-ignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCoverage } from '../lib/learning/coverage.ts';
import type { Section } from '../lib/learning/types.ts';
import { createLesson } from '../server/lesson.ts';
import { createPlan } from '../server/plan.ts';
import { createProviderFromEnv } from '../server/providers/index.ts';
import type { AiProvider, LessonRequest, TokenUsage } from '../server/providers/types.ts';
import { extractSample, SAMPLE_KEYS, type SampleKey } from '../tests/helpers/samples.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // Checked below.
}
const inner = createProviderFromEnv(process.env);
if (inner.id !== 'zro') {
  console.error('This script needs ZRO_API_KEY in .env (the active provider is not ZRO).');
  process.exit(2);
}

const maxCalls = Number(process.env.VALIDATE_MAX_CALLS) || 4;
interface Call {
  kind: string;
  ms: number;
  usage?: TokenUsage;
  error?: string;
  raw?: string;
}
const calls: Call[] = [];

/** Counts, times and records every request, and refuses any beyond the limit before it is sent. */
const provider: AiProvider = {
  id: inner.id,
  model: inner.model,
  async generate(request: LessonRequest) {
    if (calls.length >= maxCalls) throw new Error('call budget reached');
    const call: Call = { kind: request.task?.kind ?? 'course', ms: 0 };
    calls.push(call);
    const started = performance.now();
    try {
      const text = await inner.generate({
        ...request,
        onUsage: (u) => {
          call.usage = u;
          request.onUsage?.(u);
        },
      });
      call.raw = text;
      return text;
    } catch (err) {
      call.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      call.ms = Math.round(performance.now() - started);
    }
  },
};

const key = (process.argv.slice(2).find((a) => (SAMPLE_KEYS as string[]).includes(a)) ?? 'biology') as SampleKey;
const doc = await extractSample(key);
const source = { name: doc.name, pageCount: doc.pageCount, pages: doc.pages };
const report: Record<string, unknown> = { sample: key, model: provider.model, maxCalls, startedAt: new Date().toISOString() };
const sections: Section[] = [];
const states: Array<{ lessonId: string; status: 'pending' | 'ready' | 'failed'; reason?: string }> = [];

try {
  const { documentId, plan } = await createPlan(source, provider, { maxLessons: 10, maxTokens: 8000 });
  report.plan = plan;
  const taught: string[] = [];
  for (const lesson of plan.lessons) {
    if (calls.length >= maxCalls) {
      states.push({ lessonId: lesson.id, status: 'pending', reason: 'skipped: call limit of this run reached' });
      continue;
    }
    const concepts = plan.concepts.filter((c) => lesson.conceptIds.includes(c.id));
    try {
      const result = await createLesson(
        { documentId, documentName: doc.name, pages: doc.pages.filter((p) => lesson.pages.includes(p.page)), lesson, concepts, taught: [...taught] },
        provider,
        { maxTokens: 6000 },
      );
      sections.push(result.section);
      states.push({ lessonId: lesson.id, status: 'ready' });
      taught.push(...concepts.map((c) => c.name));
      (report.lessonReports ??= {} as Record<string, unknown>);
      (report.lessonReports as Record<string, unknown>)[lesson.id] = result.report;
    } catch (err) {
      states.push({ lessonId: lesson.id, status: 'failed', reason: err instanceof Error ? err.message : String(err) });
    }
  }
  report.sections = sections;
  report.states = states;
  report.coverage = computeCoverage(plan, sections, states);
} catch (err) {
  report.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
report.calls = calls;
report.pages = doc.pages;

const outDir = join('.claude', 'validation');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `adaptive-${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));

const tokensIn = calls.reduce((n, c) => n + (c.usage?.promptTokens ?? 0), 0);
const tokensOut = calls.reduce((n, c) => n + (c.usage?.outputTokens ?? 0), 0);
console.log(`[${key}] model=${provider.model} requests=${calls.length} (limit ${maxCalls})`);
for (const c of calls) {
  console.log(`  ${c.kind}: ${c.ms}ms prompt=${c.usage?.promptTokens ?? '-'} output=${c.usage?.outputTokens ?? '-'}${c.usage?.estimated ? ' (estimated)' : ''}${c.error ? ` error=${c.error}` : ''}`);
}
console.log(`  total: ${calls.reduce((n, c) => n + c.ms, 0)}ms prompt=${tokensIn} output=${tokensOut}`);
if (report.error) console.log(`  error: ${report.error}`);
console.log(`  report: ${file}`);
process.exit(report.error ? 1 : 0);
