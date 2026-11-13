import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { LIMITS, type ApiErrorBody, type GenerateResponse } from '../lib/learning/contracts.ts';
import { createApp, type AppOptions } from '../server/app.ts';
import { MockProvider } from '../server/providers/mock.ts';
import { ProviderError, type AiProvider } from '../server/providers/types.ts';
import { RateLimiter, TtlCache } from '../server/security.ts';
import { extractSample } from './helpers/samples.ts';

const ORIGIN = 'http://localhost:3000';
let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function start(options: Partial<AppOptions> = {}) {
  const logs: string[] = [];
  const app = createApp({
    provider: new MockProvider(),
    allowedOrigins: [ORIGIN],
    log: (line) => logs.push(line),
    ...options,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, origin: string | null = ORIGIN, contentType = 'application/json') =>
    fetch(`${base}/api/lessons/generate`, {
      method: 'POST',
      headers: { 'content-type': contentType, ...(origin ? { origin } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { base, post, logs };
}

/** Counts how often the wrapped provider is actually called. */
function counting(inner: AiProvider = new MockProvider()) {
  const p = {
    id: inner.id,
    model: inner.model,
    calls: 0,
    generate: (req: Parameters<AiProvider['generate']>[0]) => {
      p.calls++;
      return inner.generate(req);
    },
  };
  return p;
}

const payload = async () => {
  const doc = await extractSample('computing');
  return { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } };
};

describe('lesson backend HTTP API', () => {
  it('reports health and the active provider', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/health`, { headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: 'mock', model: 'offline-extractive' });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('generates a verified course from extracted text', async () => {
    const { post } = await start();
    const res = await post(await payload());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as GenerateResponse;
    expect(body.cached).toBe(false);
    expect(body.course.sections).toHaveLength(3);
    expect(body.course.provenance.kind).toBe('pdf');
  });

  it('reuses a stored result instead of calling the AI provider again', async () => {
    const provider = counting();
    const { post } = await start({ provider });
    const body = await payload();
    const first = (await (await post(body)).json()) as GenerateResponse;
    const second = (await (await post(body)).json()) as GenerateResponse;
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.course.id).toBe(first.course.id);
    expect(provider.calls).toBe(1);
  });

  it('shares one AI call between identical requests sent at the same time', async () => {
    const provider = counting();
    const { post } = await start({ provider });
    const body = await payload();
    const responses = await Promise.all([post(body), post(body), post(body)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(provider.calls).toBe(1);
  });

  it('blocks browsers from origins that are not on the allow-list', async () => {
    const { post } = await start();
    const res = await post(await payload(), 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('forbidden_origin');
  });

  it('rejects requests without an Origin unless explicitly allowed', async () => {
    const closed = await start();
    expect((await closed.post(await payload(), null)).status).toBe(403);
    await new Promise<void>((r) => server!.close(() => r()));
    const open = await start({ allowNoOrigin: true });
    expect((await open.post(await payload(), null)).status).toBe(200);
  });

  it('answers CORS preflight for allowed origins only', async () => {
    const { base } = await start();
    const ok = await fetch(`${base}/api/lessons/generate`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    const bad = await fetch(`${base}/api/lessons/generate`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
  });

  it('rate-limits repeated requests from one client', async () => {
    const { post } = await start({ rateLimit: { max: 2, windowMs: 60_000 } });
    const body = await payload();
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const third = await post(body);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await third.json()) as ApiErrorBody).error.code).toBe('rate_limited');
  });

  it('stops calling the AI provider after the daily cap', async () => {
    const { post } = await start({ dailyGenerationCap: 1 });
    const a = await payload();
    const doc = await extractSample('history');
    const b = { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } };
    expect((await post(a)).status).toBe(200);
    const res = await post(b);
    expect(res.status).toBe(503);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('provider_rate_limited');
  });

  it('rejects malformed, non-JSON, tiny and oversized requests', async () => {
    const { post } = await start({ rateLimit: { max: 50, windowMs: 60_000 } });
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ nope: true })).status).toBe(400);
    expect((await post(await payload(), ORIGIN, 'text/plain')).status).toBe(415);
    expect((await post({ document: { name: 'a.pdf', pageCount: 1, pages: [{ page: 1, text: 'too short' }] } })).status).toBe(400);
    const dup = { document: { name: 'a.pdf', pageCount: 2, pages: [{ page: 1, text: 'x'.repeat(300) }, { page: 1, text: 'y'.repeat(300) }] } };
    expect((await post(dup)).status).toBe(400);
    const huge = { document: { name: 'a.pdf', pageCount: 1, pages: [{ page: 1, text: 'z'.repeat(LIMITS.maxBodyBytes + 10) }] } };
    expect((await post(huge)).status).toBe(413);
  });

  it('turns provider failures into clear, non-leaking errors', async () => {
    const failing = (code: 'rate_limited' | 'not_configured' | 'failed'): AiProvider => ({
      id: 'gemini',
      model: 'm',
      generate: async () => {
        throw new ProviderError(code, 'internal detail: key=SECRET');
      },
    });
    const quota = await start({ provider: failing('rate_limited') });
    const r1 = await quota.post(await payload());
    expect(r1.status).toBe(503);
    expect(((await r1.json()) as ApiErrorBody).error.code).toBe('provider_rate_limited');
    await new Promise<void>((r) => server!.close(() => r()));

    const config = await start({ provider: failing('not_configured') });
    const r2 = await config.post(await payload());
    const body2 = (await r2.json()) as ApiErrorBody;
    expect(r2.status).toBe(503);
    expect(body2.error.code).toBe('provider_not_configured');
    expect(body2.error.message).not.toContain('SECRET');
  });

  it('returns 422 when nothing in the AI output matches the document', async () => {
    const liar: AiProvider = {
      id: 'liar',
      model: 'm',
      generate: async () =>
        JSON.stringify({
          sections: [
            {
              level: 'Beginner',
              title: 'Made up',
              notes: [{ title: 'x', body: 'Dragons invented the telephone in ancient Atlantis.', citations: [{ page: 1, quote: 'Dragons invented the telephone in ancient Atlantis.' }] }],
              questions: [],
            },
          ],
        }),
    };
    const { post } = await start({ provider: liar });
    const res = await post(await payload());
    expect(res.status).toBe(422);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('nothing_grounded');
  });

  it('never writes document text or names to the log', async () => {
    const { post, logs } = await start();
    await post(await payload());
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    expect(all).not.toContain('kernel');
    expect(all).not.toContain('operating-systems');
    expect(all).toMatch(/POST \/api\/lessons\/generate 200 \d+ms/);
  });

  it('returns 404 for unknown paths', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/secret`, { headers: { origin: ORIGIN } })).status).toBe(404);
  });
});

describe('security helpers', () => {
  it('rate limiter resets after its window', () => {
    let t = 0;
    const limiter = new RateLimiter(1, 1000, () => t);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
    expect(limiter.check('b').ok).toBe(true);
    t = 1001;
    expect(limiter.check('a').ok).toBe(true);
  });

  it('cache expires entries and evicts the oldest', () => {
    let t = 0;
    const cache = new TtlCache<number>(2, 1000, () => t);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    t = 1001;
    expect(cache.get('c')).toBeUndefined();
  });
});
