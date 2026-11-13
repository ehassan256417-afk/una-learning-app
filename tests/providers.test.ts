import { describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { createProviderFromEnv } from '../server/providers/index.ts';
import { DEFAULT_GEMINI_MODEL, GeminiProvider } from '../server/providers/gemini.ts';
import { ProviderError } from '../server/providers/types.ts';

const request = { system: 'SYSTEM RULES', prompt: 'PROMPT TEXT', pages: [] };

/** Records the outgoing request and replies with a canned response. */
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const okBody = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"sections":' }, { text: '[]}' }] } }] };

describe('provider selection', () => {
  it('uses the offline mock when no key is configured', () => {
    expect(createProviderFromEnv({}).id).toBe('mock');
  });

  it('uses Gemini when a key is present', () => {
    const p = createProviderFromEnv({ GEMINI_API_KEY: 'test-key' });
    expect(p.id).toBe('gemini');
    expect(p.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('honours AI_PROVIDER=mock even when a key is present', () => {
    expect(createProviderFromEnv({ AI_PROVIDER: 'mock', GEMINI_API_KEY: 'test-key' }).id).toBe('mock');
  });

  it('refuses Gemini without a key and unknown providers', () => {
    expect(() => createProviderFromEnv({ AI_PROVIDER: 'gemini' })).toThrow(ProviderError);
    expect(() => createProviderFromEnv({ AI_PROVIDER: 'something-else' })).toThrow(ProviderError);
  });
});

describe('GeminiProvider', () => {
  it('sends the key in a header, never in the URL, and asks for JSON', async () => {
    const { impl, calls } = fakeFetch(200, okBody);
    const provider = new GeminiProvider({ apiKey: 'SECRET-KEY-123', model: 'gemini-test', fetchImpl: impl });
    const text = await provider.generate(request);

    expect(text).toBe('{"sections":[]}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(calls[0].url).not.toContain('SECRET-KEY-123');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET-KEY-123');

    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.systemInstruction.parts[0].text).toBe('SYSTEM RULES');
    expect(sent.contents[0].parts[0].text).toBe('PROMPT TEXT');
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(String(calls[0].init.body)).not.toContain('SECRET-KEY-123');
  });

  it('maps quota errors to a rate-limit error', async () => {
    const provider = new GeminiProvider({ apiKey: 'k', fetchImpl: fakeFetch(429, { error: { message: 'quota' } }).impl });
    await expect(provider.generate(request)).rejects.toMatchObject({ name: 'ProviderError', code: 'rate_limited' });
  });

  it('maps rejected credentials to a configuration error without leaking the key', async () => {
    const provider = new GeminiProvider({
      apiKey: 'SECRET-KEY-123',
      fetchImpl: fakeFetch(403, { error: { message: 'API key SECRET-KEY-123 invalid' } }).impl,
    });
    const err = await provider.generate(request).catch((e: unknown) => e as ProviderError);
    expect(err).toMatchObject({ code: 'not_configured' });
    expect((err as ProviderError).message).not.toContain('SECRET-KEY-123');
  });

  it('reports other HTTP failures, blocked prompts and cut-off answers', async () => {
    const server = new GeminiProvider({ apiKey: 'k', fetchImpl: fakeFetch(500, {}).impl });
    await expect(server.generate(request)).rejects.toMatchObject({ code: 'failed' });

    const blocked = new GeminiProvider({ apiKey: 'k', fetchImpl: fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } }).impl });
    await expect(blocked.generate(request)).rejects.toMatchObject({ code: 'failed' });

    const cut = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"sections":[' }] } }] };
    const truncated = new GeminiProvider({ apiKey: 'k', fetchImpl: fakeFetch(200, cut).impl });
    await expect(truncated.generate(request)).rejects.toMatchObject({ code: 'failed' });
  });

  it('reports network failures', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider({ apiKey: 'k', fetchImpl: impl });
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'failed' });
  });
});
