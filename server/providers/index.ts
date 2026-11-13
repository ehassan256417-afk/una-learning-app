import { GeminiProvider } from './gemini.ts';
import { MockProvider } from './mock.ts';
import { ProviderError, type AiProvider } from './types.ts';
import { ZroProvider } from './zro.ts';

export type { AiProvider, LessonRequest } from './types.ts';
export { ProviderError } from './types.ts';

/**
 * Chooses the provider from server environment variables.
 *   AI_PROVIDER=zro     uses ZRO_API_KEY (and optional ZRO_MODEL, ZRO_REASONING_EFFORT, ZRO_MAX_TOKENS, ZRO_BASE_URL)
 *   AI_PROVIDER=gemini  uses GEMINI_API_KEY (and optional GEMINI_MODEL)
 *   AI_PROVIDER=mock    offline, no network and no key
 * With no AI_PROVIDER set, ZRO is used when ZRO_API_KEY is present, then Gemini
 * when GEMINI_API_KEY is present, otherwise the mock.
 */
export function createProviderFromEnv(env: Record<string, string | undefined>): AiProvider {
  const fallback = env.ZRO_API_KEY ? 'zro' : env.GEMINI_API_KEY ? 'gemini' : 'mock';
  const choice = (env.AI_PROVIDER || fallback).toLowerCase();
  if (choice === 'mock') return new MockProvider();
  if (choice === 'zro') {
    return new ZroProvider({
      apiKey: env.ZRO_API_KEY ?? '',
      model: env.ZRO_MODEL,
      baseUrl: env.ZRO_BASE_URL,
      reasoningEffort: env.ZRO_REASONING_EFFORT,
      maxTokens: Number(env.ZRO_MAX_TOKENS) || undefined,
    });
  }
  if (choice === 'gemini') {
    return new GeminiProvider({ apiKey: env.GEMINI_API_KEY ?? '', model: env.GEMINI_MODEL });
  }
  throw new ProviderError('not_configured', `Unknown AI_PROVIDER "${choice}". Use "zro", "gemini" or "mock".`);
}
