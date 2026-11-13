import { describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { createProviderFromEnv } from '../server/providers/index.ts';
import { DEFAULT_GEMINI_MODEL, GeminiProvider } from '../server/providers/gemini.ts';
import { ProviderError } from '../server/providers/types.ts';
import { DEFAULT_ZRO_MAX_TOKENS, DEFAULT_ZRO_MODEL, ZroProvider } from '../server/providers/zro.ts';

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

  it('prefers ZRO when its key is present, even next to a Gemini key', () => {
    const p = createProviderFromEnv({ ZRO_API_KEY: 'sk-test', GEMINI_API_KEY: 'test-key' });
    expect(p.id).toBe('zro');
    expect(p.model).toBe(DEFAULT_ZRO_MODEL);
    expect(createProviderFromEnv({ ZRO_API_KEY: 'sk-test', ZRO_MODEL: 'glm-5.3' }).model).toBe('glm-5.3');
  });

  it('lets AI_PROVIDER override the default choice and refuses ZRO without a key', () => {
    expect(createProviderFromEnv({ AI_PROVIDER: 'gemini', ZRO_API_KEY: 'sk-test', GEMINI_API_KEY: 'k' }).id).toBe('gemini');
    expect(createProviderFromEnv({ AI_PROVIDER: 'mock', ZRO_API_KEY: 'sk-test' }).id).toBe('mock');
    expect(() => createProviderFromEnv({ AI_PROVIDER: 'zro' })).toThrow(ProviderError);
    expect(() => createProviderFromEnv({ ZRO_API_KEY: 'sk-test', ZRO_REASONING_EFFORT: 'extreme' })).toThrow(ProviderError);
  });
});

describe('ZroProvider', () => {
  const chat = (content: string | null, finish = 'stop') => ({
    choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

  it('sends the key as a bearer header, never in the URL or body, and asks for JSON', async () => {
    const { impl, calls } = fakeFetch(200, chat('{"sections":[]}'));
    const provider = new ZroProvider({ apiKey: 'sk-SECRET-123', fetchImpl: impl });
    const text = await provider.generate(request);

    expect(text).toBe('{"sections":[]}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://zro.moonmath.ai/v1/chat/completions');
    expect(calls[0].url).not.toContain('sk-SECRET-123');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-SECRET-123');
    expect(String(calls[0].init.body)).not.toContain('sk-SECRET-123');

    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe(DEFAULT_ZRO_MODEL);
    expect(sent.messages).toEqual([
      { role: 'system', content: 'SYSTEM RULES' },
      { role: 'user', content: 'PROMPT TEXT' },
    ]);
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.reasoning_effort).toBe('low');
    expect(sent.max_tokens).toBe(DEFAULT_ZRO_MAX_TOKENS);
    expect(sent.stream).toBe(false);
  });

  it('applies model, reasoning, token and base URL options', async () => {
    const { impl, calls } = fakeFetch(200, chat('{}'));
    const provider = new ZroProvider({
      apiKey: 'k',
      model: 'glm-5.3',
      reasoningEffort: 'NONE',
      maxTokens: 4000,
      baseUrl: 'http://127.0.0.1:9999/v1/',
      fetchImpl: impl,
    });
    await provider.generate(request);
    expect(calls[0].url).toBe('http://127.0.0.1:9999/v1/chat/completions');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe('glm-5.3');
    expect(sent.reasoning_effort).toBe('none');
    expect(sent.max_tokens).toBe(4000);
  });

  it('refuses a missing key, an unknown reasoning level and a non-https base URL', () => {
    expect(() => new ZroProvider({ apiKey: '' })).toThrow(ProviderError);
    expect(() => new ZroProvider({ apiKey: 'k', reasoningEffort: 'extreme' })).toThrow(ProviderError);
    expect(() => new ZroProvider({ apiKey: 'k', baseUrl: 'http://example.com/v1' })).toThrow(ProviderError);
  });

  it('maps rate limits and a used-up budget to a rate-limit error', async () => {
    for (const status of [429, 402]) {
      const provider = new ZroProvider({ apiKey: 'k', fetchImpl: fakeFetch(status, { error: { message: 'limit', type: 'x' } }).impl });
      await expect(provider.generate(request)).rejects.toMatchObject({ name: 'ProviderError', code: 'rate_limited' });
    }
  });

  it('maps rejected credentials and unknown models to a configuration error without leaking the key', async () => {
    for (const status of [401, 403, 404]) {
      const provider = new ZroProvider({
        apiKey: 'sk-SECRET-123',
        fetchImpl: fakeFetch(status, { error: { message: 'key sk-SECRET-123 is not valid', type: 'auth' } }).impl,
      });
      const err = await provider.generate(request).catch((e: unknown) => e as ProviderError);
      expect(err).toMatchObject({ code: 'not_configured' });
      expect((err as ProviderError).message).not.toContain('sk-SECRET-123');
    }
  });

  it('reports server errors, empty answers and cut-off answers', async () => {
    const server = new ZroProvider({ apiKey: 'k', fetchImpl: fakeFetch(503, { error: { message: 'busy sk-x', type: 'upstream' } }).impl });
    const err = await server.generate(request).catch((e: unknown) => e as ProviderError);
    expect(err).toMatchObject({ code: 'failed' });
    expect((err as ProviderError).message).not.toContain('busy');

    const empty = new ZroProvider({ apiKey: 'k', fetchImpl: fakeFetch(200, chat(null)).impl });
    await expect(empty.generate(request)).rejects.toMatchObject({ code: 'failed' });

    const none = new ZroProvider({ apiKey: 'k', fetchImpl: fakeFetch(200, {}).impl });
    await expect(none.generate(request)).rejects.toMatchObject({ code: 'failed' });

    const cut = new ZroProvider({ apiKey: 'k', fetchImpl: fakeFetch(200, chat('{"sections":[', 'length')).impl });
    await expect(cut.generate(request)).rejects.toMatchObject({ code: 'failed' });
  });

  it('reports network failures', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const provider = new ZroProvider({ apiKey: 'k', fetchImpl: impl });
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'failed' });
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
