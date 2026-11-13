/**
 * Phase 2.5: runs the real lesson pipeline against a live AI provider and
 * writes a report for manual review. THIS MAKES REAL API CALLS that count
 * against the provider's quota or budget; run it only on purpose.
 *
 *   node scripts/validate-provider.ts [zro|gemini] [biology|history|computing ...]
 *
 * Reads ZRO_API_KEY or GEMINI_API_KEY (and the optional model settings) from
 * the git-ignored .env. With no provider named, ZRO is used when its key is
 * set, otherwise Gemini. The key is only ever placed in the request header by
 * the provider; this script never prints or stores it. Reports go to
 * .claude/validation/, which is git-ignored. Uses the synthetic sample PDFs
 * from the tests, so no real course material is sent to the provider.
 *
 * Status: run against Gemini on 2026-11-13. Not yet run against ZRO.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PageIndex, verifyItem, type RawCitation } from '../lib/learning/verify.ts';
import { documentIdFor } from '../lib/pdf/extract.ts';
import { generateCourse } from '../server/generate.ts';
import { GeminiProvider } from '../server/providers/gemini.ts';
import type { AiProvider, LessonRequest } from '../server/providers/types.ts';
import { ZroProvider } from '../server/providers/zro.ts';
import { parseLessonJson, type RawLesson } from '../server/schema.ts';
import { extractSample, SAMPLE_KEYS, type SampleKey } from '../tests/helpers/samples.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // Fall through to the check below.
}

const args = process.argv.slice(2);
const named = args.find((a) => a === 'zro' || a === 'gemini');
const providerId: 'zro' | 'gemini' = named === 'gemini' || (!named && !process.env.ZRO_API_KEY) ? 'gemini' : 'zro';
const keyName = providerId === 'zro' ? 'ZRO_API_KEY' : 'GEMINI_API_KEY';
const apiKey = process.env[keyName] ?? '';
if (!apiKey) {
  console.error(`${keyName} is not set. Put it in .env in the project root (git-ignored).`);
  process.exit(2);
}

interface Usage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
}

const fromOpenAiUsage = (u: OpenAiUsage): Usage => ({
  promptTokenCount: u.prompt_tokens,
  candidatesTokenCount: u.completion_tokens,
  thoughtsTokenCount: u.completion_tokens_details?.reasoning_tokens,
  totalTokenCount: u.total_tokens,
});

interface ApiCall {
  /** Time until the response headers arrived. */
  firstByteMs?: number;
  streamed?: boolean;
  /** Total time until the whole body was read. */
  ms: number;
  status: number;
  finishReason?: string;
  modelVersion?: string;
  usage?: Usage;
  /** Provider error status/message only (never request details). */
  error?: string;
  requestChars: number;
  responseChars: number;
}

const calls: ApiCall[] = [];

/**
 * Experiment overrides, applied to the request body only inside this script:
 *   VALIDATE_MAX_OUTPUT_TOKENS=32768       replaces generationConfig.maxOutputTokens
 *   VALIDATE_THINKING='{"thinkingLevel":"low"}'  sets generationConfig.thinkingConfig
 *   VALIDATE_TIMEOUT_MS=180000             provider timeout
 * With none set, the request is exactly what GeminiProvider sends.
 */
const overrideMaxTokens = Number(process.env.VALIDATE_MAX_OUTPUT_TOKENS) || undefined;
const overrideThinking = process.env.VALIDATE_THINKING ? (JSON.parse(process.env.VALIDATE_THINKING) as object) : undefined;
const overrideTimeout = Number(process.env.VALIDATE_TIMEOUT_MS) || undefined;

function applyOverrides(init: RequestInit | undefined): RequestInit | undefined {
  // Gemini request shape only; ZRO is tuned through ZRO_MAX_TOKENS and ZRO_REASONING_EFFORT.
  if (providerId !== 'gemini') return init;
  if (!init || typeof init.body !== 'string' || (!overrideMaxTokens && !overrideThinking)) return init;
  const body = JSON.parse(init.body) as { generationConfig?: Record<string, unknown> };
  body.generationConfig = { ...body.generationConfig };
  if (overrideMaxTokens) body.generationConfig.maxOutputTokens = overrideMaxTokens;
  if (overrideThinking) body.generationConfig.thinkingConfig = overrideThinking;
  return { ...init, body: JSON.stringify(body) };
}

/**
 * VALIDATE_MAX_CALLS=1 is a hard budget for the whole run: once that many
 * requests have been started, further ones (for example the pipeline's retry
 * after invalid JSON) are refused locally and never reach the network.
 */
const maxCalls = Number(process.env.VALIDATE_MAX_CALLS) || undefined;
let callsStarted = 0;

/** Wraps fetch to time each call and read the usage block from a copy of the response. */
const meteredFetch: typeof fetch = async (input, rawInit) => {
  if (maxCalls && callsStarted >= maxCalls) throw new Error('call budget reached');
  callsStarted++;
  const init = applyOverrides(rawInit);
  const started = performance.now();
  const requestChars = typeof init?.body === 'string' ? init.body.length : 0;
  try {
    const response = await fetch(input, init);
    const firstByteMs = Math.round(performance.now() - started);
    const call: ApiCall = { ms: firstByteMs, firstByteMs, status: response.status, requestChars, responseChars: 0 };
    try {
      const text = await response.clone().text();
      call.ms = Math.round(performance.now() - started);
      call.responseChars = text.length;
      if (/^\s*(data|event|:)/.test(text)) {
        // Streamed (server-sent events): the finish reason and usage arrive in late chunks.
        call.streamed = true;
        for (const line of text.split(/\r?\n/)) {
          if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
          try {
            const chunk = JSON.parse(line.slice(5)) as {
              model?: string;
              choices?: Array<{ finish_reason?: string | null }>;
              usage?: OpenAiUsage;
              error?: { type?: string; message?: string };
            };
            call.modelVersion = chunk.model ?? call.modelVersion;
            call.finishReason = chunk.choices?.[0]?.finish_reason ?? call.finishReason;
            if (chunk.usage) call.usage = fromOpenAiUsage(chunk.usage);
            if (chunk.error) call.error = `${chunk.error.type ?? ''}: ${(chunk.error.message ?? '').slice(0, 300)}`;
          } catch {
            // Skip a malformed event.
          }
        }
        calls.push(call);
        return response;
      }
      // Gemini and OpenAI-style (ZRO) responses name these fields differently.
      const data = JSON.parse(text) as {
        candidates?: Array<{ finishReason?: string }>;
        usageMetadata?: Usage;
        modelVersion?: string;
        choices?: Array<{ finish_reason?: string }>;
        model?: string;
        usage?: OpenAiUsage;
        error?: { status?: string; type?: string; message?: string };
      };
      call.finishReason = data.candidates?.[0]?.finishReason ?? data.choices?.[0]?.finish_reason;
      call.modelVersion = data.modelVersion ?? data.model;
      call.usage = data.usageMetadata ?? (data.usage && fromOpenAiUsage(data.usage));
      if (data.error) {
        call.error = `${data.error.status ?? data.error.type ?? ''}: ${(data.error.message ?? '').slice(0, 300)}`;
      }
    } catch {
      // Body was not JSON; status and timing are still recorded.
    }
    calls.push(call);
    return response;
  } catch (err) {
    calls.push({
      ms: Math.round(performance.now() - started),
      status: 0,
      requestChars,
      responseChars: 0,
      error: err instanceof Error ? err.name : 'network error',
    });
    throw err;
  }
};

/** Keeps the raw model text of every attempt so dropped items can be inspected. */
class RecordingProvider implements AiProvider {
  readonly id: string;
  readonly model: string;
  readonly rawOutputs: string[] = [];
  private inner: AiProvider;

  constructor(inner: AiProvider) {
    this.inner = inner;
    this.id = inner.id;
    this.model = inner.model;
  }

  async generate(request: LessonRequest): Promise<string> {
    const text = await this.inner.generate(request);
    this.rawOutputs.push(text);
    return text;
  }
}

interface ItemVerdict {
  level: string;
  kind: string;
  claim: string;
  citations: RawCitation[];
  kept: boolean;
  reason?: string;
}

/** Re-runs the same grounding check per raw item, to list exactly what was kept and dropped. */
function verdicts(raw: RawLesson, index: PageIndex, documentId: string): ItemVerdict[] {
  const out: ItemVerdict[] = [];
  const add = (level: string, kind: string, claim: string, citations: RawCitation[]) => {
    const result = verifyItem(claim, citations, index, documentId);
    out.push({ level, kind, claim, citations, kept: result.ok, reason: result.ok ? undefined : result.reason });
  };
  for (const s of raw.sections) {
    s.notes.forEach((n) => add(s.level, 'note', n.body, n.citations));
    s.questions.forEach((q) => add(s.level, 'question', `${q.choices[q.answerIndex]} ${q.explanation}`, q.citations));
    s.flashcards.forEach((f) => add(s.level, 'flashcard', f.back, f.citations));
    s.keyPoints.forEach((k) => add(s.level, 'key point', k.text, k.citations));
  }
  return out;
}

async function listModels(): Promise<string[]> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': apiKey },
    });
    const data = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  } catch {
    return [];
  }
}

const requested = args.filter((a): a is SampleKey => (SAMPLE_KEYS as string[]).includes(a));
const keys: SampleKey[] = requested.length ? requested : ['biology'];
const outDir = join('.claude', 'validation');
mkdirSync(outDir, { recursive: true });

let failed = false;
for (const key of keys) {
  calls.length = 0;
  const doc = await extractSample(key);
  const document = { name: doc.name, pageCount: doc.pageCount, pages: doc.pages };
  const provider = new RecordingProvider(
    providerId === 'zro'
      ? new ZroProvider({
          apiKey,
          model: process.env.ZRO_MODEL || undefined,
          baseUrl: process.env.ZRO_BASE_URL || undefined,
          reasoningEffort: process.env.ZRO_REASONING_EFFORT || undefined,
          maxTokens: Number(process.env.ZRO_MAX_TOKENS) || undefined,
          fetchImpl: meteredFetch,
          timeoutMs: overrideTimeout,
        })
      : new GeminiProvider({
          apiKey,
          model: process.env.GEMINI_MODEL || undefined,
          fetchImpl: meteredFetch,
          timeoutMs: overrideTimeout,
        }),
  );
  const started = performance.now();
  const report: Record<string, unknown> = {
    sample: key,
    documentName: doc.name,
    pages: doc.pages,
    model: provider.model,
    overrides: { maxOutputTokens: overrideMaxTokens, thinkingConfig: overrideThinking, timeoutMs: overrideTimeout },
    startedAt: new Date().toISOString(),
  };
  try {
    const course = await generateCourse(document, provider);
    report.course = course;
  } catch (err) {
    failed = true;
    report.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (providerId === 'gemini' && calls.some((c) => c.status === 404)) report.availableModels = await listModels();
  }
  report.totalMs = Math.round(performance.now() - started);
  report.calls = [...calls];
  report.rawOutputs = provider.rawOutputs;
  const lastRaw = provider.rawOutputs.at(-1);
  if (lastRaw) {
    try {
      const raw = parseLessonJson(lastRaw);
      report.malformed = raw.malformed;
      report.verdicts = verdicts(raw, new PageIndex(doc.pages), await documentIdFor(doc.pages));
    } catch (err) {
      report.parseError = err instanceof Error ? err.message : String(err);
    }
  }

  const file = join(outDir, `${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));

  const v = (report.verdicts as ItemVerdict[] | undefined) ?? [];
  console.log(`\n[${key}] provider=${provider.id} model=${provider.model} totalMs=${report.totalMs} calls=${calls.length}`);
  for (const c of calls) {
    console.log(
      `  call: HTTP ${c.status} ${c.ms}ms (headers after ${c.firstByteMs ?? '-'}ms, streamed=${c.streamed ?? false}) finish=${c.finishReason ?? '-'} ` +
        `tokens(prompt=${c.usage?.promptTokenCount ?? '-'}, output=${c.usage?.candidatesTokenCount ?? '-'}, ` +
        `thinking=${c.usage?.thoughtsTokenCount ?? '-'}, total=${c.usage?.totalTokenCount ?? '-'})` +
        (c.error ? ` error=${c.error}` : ''),
    );
  }
  if (report.error) console.log(`  error: ${report.error}`);
  if (v.length) console.log(`  items: ${v.filter((x) => x.kept).length} kept / ${v.length} checked, malformed=${report.malformed}`);
  for (const x of v.filter((x) => !x.kept)) console.log(`  dropped ${x.level} ${x.kind}: ${x.reason}`);
  console.log(`  report: ${file}`);
}
process.exit(failed ? 1 : 0);
