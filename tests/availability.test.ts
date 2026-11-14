import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import type { ApiErrorBody, GenerateResponse, HealthResponse, PlanResponse } from '../lib/learning/contracts.ts';
import { createApp, type AppOptions } from '../server/app.ts';
import { ProviderAvailability } from '../server/availability.ts';
import { MockProvider } from '../server/providers/mock.ts';
import { ProviderError, retryAfterSeconds, type LessonRequest } from '../server/providers/types.ts';
import { extractSample } from './helpers/samples.ts';

describe('provider availability tracker', () => {
  it('pauses a provider after an outage and waits longer each time the outage repeats', () => {
    let now = 0;
    const tracker = new ProviderAvailability(() => now);
    expect(tracker.waitSec('zro|m')).toBe(0);

    expect(tracker.failed('zro|m')).toBe(30);
    expect(tracker.waitSec('zro|m')).toBe(30);
    // Another provider or model is not affected.
    expect(tracker.waitSec('zro|other')).toBe(0);

    now += 10_000;
    expect(tracker.waitSec('zro|m')).toBe(20);
    // Requests that were already running when the pause began do not lengthen it.
    expect(tracker.failed('zro|m')).toBe(20);

    now += 21_000;
    expect(tracker.waitSec('zro|m')).toBe(0);
    expect(tracker.failed('zro|m')).toBe(60);
    now += 61_000;
    expect(tracker.failed('zro|m')).toBe(120);
    now += 121_000;
    expect(tracker.failed('zro|m')).toBe(300);
    now += 301_000;
    expect(tracker.failed('zro|m')).toBe(300);
  });

  it('starts from the short pause again after a success or a long quiet spell', () => {
    let now = 0;
    const tracker = new ProviderAvailability(() => now);
    tracker.failed('k');
    now += 31_000;
    tracker.failed('k');
    now += 61_000;
    tracker.succeeded('k');
    expect(tracker.waitSec('k')).toBe(0);
    expect(tracker.failed('k')).toBe(30);

    now += 31_000;
    expect(tracker.failed('k')).toBe(60);
    now += 60 * 60_000;
    expect(tracker.failed('k')).toBe(30);
  });

  it('waits as long as the provider asks, within a cap', () => {
    const tracker = new ProviderAvailability(() => 0);
    expect(tracker.failed('a', 90)).toBe(90);
    expect(tracker.failed('b', 5)).toBe(30);
    expect(tracker.failed('c', 86_400)).toBe(900);
    expect(tracker.failed('d', Number.NaN)).toBe(30);
  });

  it('reads Retry-After as seconds and ignores anything else', () => {
    expect(retryAfterSeconds('120')).toBe(120);
    expect(retryAfterSeconds(' 7 ')).toBe(7);
    expect(retryAfterSeconds(null)).toBeUndefined();
    expect(retryAfterSeconds('')).toBeUndefined();
    expect(retryAfterSeconds('-5')).toBeUndefined();
    expect(retryAfterSeconds('soon')).toBeUndefined();
    expect(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
  });
});

describe('provider outage over HTTP', () => {
  const ORIGIN = 'http://localhost:3000';
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  /** Fails like a provider that answers HTTP 503 until `down` is cleared. */
  function flaky() {
    const inner = new MockProvider();
    const p = {
      id: 'zro',
      model: 'test-model',
      calls: 0,
      down: true,
      generate: async (req: LessonRequest) => {
        p.calls++;
        if (p.down) throw new ProviderError('unavailable', 'The AI provider is temporarily unavailable (HTTP 503).');
        return inner.generate(req);
      },
    };
    return p;
  }

  async function start(options: Partial<AppOptions> = {}) {
    const logs: string[] = [];
    const clock = { now: 1_000_000 };
    server = createServer(
      createApp({
        provider: new MockProvider(),
        allowedOrigins: [ORIGIN],
        log: (line) => logs.push(line),
        availability: new ProviderAvailability(() => clock.now),
        rateLimit: { max: 50, windowMs: 60_000 },
        ...options,
      }),
    );
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
    const health = async () => (await (await fetch(`${base}/api/health`, { headers: { origin: ORIGIN } })).json()) as HealthResponse;
    return { post, health, logs, clock };
  }

  const documentOf = async (key: 'computing' | 'history') => {
    const doc = await extractSample(key);
    return { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } };
  };

  it('answers 503 with a clear message, then stops calling the provider until the pause is over', async () => {
    const provider = flaky();
    const { post, health, logs, clock } = await start({ provider, courseBudget: { maxRequests: 2, maxTokens: 1_000_000 } });
    const body = await documentOf('computing');

    const first = await post('/api/lessons/plan', body);
    expect(first.status).toBe(503);
    expect(first.headers.get('retry-after')).toBe('30');
    const error = ((await first.json()) as ApiErrorBody).error;
    expect(error.code).toBe('provider_unavailable');
    expect(error.message).toContain('temporarily unavailable');
    expect(error.message).toContain('30 seconds');
    expect(provider.calls).toBe(1);
    expect(logs.some((l) => l.startsWith('provider zro unavailable'))).toBe(true);
    expect((await health()).providerRetryAfterSec).toBe(30);

    // Asking again during the pause, for this or any other document, does not reach the provider.
    clock.now += 10_000;
    const second = await post('/api/lessons/plan', body);
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('20');
    expect(((await second.json()) as ApiErrorBody).error.code).toBe('provider_unavailable');
    expect((await post('/api/lessons/plan', await documentOf('history'))).status).toBe(503);
    expect(provider.calls).toBe(1);

    // After the pause the next request goes through, and the outage cost the course nothing.
    clock.now += 21_000;
    provider.down = false;
    const third = await post('/api/lessons/plan', body);
    expect(third.status).toBe(200);
    const planned = (await third.json()) as PlanResponse;
    expect(provider.calls).toBe(2);
    expect(planned.budget.requests).toBe(1);
    expect(planned.budget.tokens).toBeGreaterThan(0);
    expect((await health()).providerRetryAfterSec).toBeUndefined();
  });

  it('never repeats the failed request on its own', async () => {
    const provider = flaky();
    const { post, clock } = await start({ provider });
    expect((await post('/api/lessons/plan', await documentOf('computing'))).status).toBe(503);
    clock.now += 10 * 60_000;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(provider.calls).toBe(1);
  });

  it('pauses the single-request endpoint the same way', async () => {
    const provider = flaky();
    const { post, clock } = await start({ provider });
    const body = await documentOf('computing');
    const first = await post('/api/lessons/generate', body);
    expect(first.status).toBe(503);
    expect(((await first.json()) as ApiErrorBody).error.code).toBe('provider_unavailable');
    expect((await post('/api/lessons/generate', body)).status).toBe(503);
    expect(provider.calls).toBe(1);

    clock.now += 31_000;
    provider.down = false;
    const ok = await post('/api/lessons/generate', body);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as GenerateResponse).course.sections.length).toBeGreaterThan(0);
  });

  it('keeps other provider failures as they were: no pause, and the request stays counted', async () => {
    const inner = new MockProvider();
    const provider = {
      id: 'zro',
      model: 'test-model',
      calls: 0,
      broken: true,
      generate: async (req: LessonRequest) => {
        provider.calls++;
        if (provider.broken) throw new ProviderError('failed', 'The AI response was cut off before the lesson was complete.');
        return inner.generate(req);
      },
    };
    const { post } = await start({ provider });
    const body = await documentOf('computing');
    const first = await post('/api/lessons/plan', body);
    expect(first.status).toBe(502);
    expect(first.headers.get('retry-after')).toBeNull();
    expect(((await first.json()) as ApiErrorBody).error.code).toBe('provider_error');

    provider.broken = false;
    const second = await post('/api/lessons/plan', body);
    expect(second.status).toBe(200);
    expect(provider.calls).toBe(2);
    expect(((await second.json()) as PlanResponse).budget.requests).toBe(2);
  });
});
