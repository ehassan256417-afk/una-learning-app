import { GeminiProvider } from './gemini.ts';
import { MockProvider } from './mock.ts';
import { ProviderError, type AiProvider } from './types.ts';

export type { AiProvider, LessonRequest } from './types.ts';
export { ProviderError } from './types.ts';

/**
 * Chooses the provider from server environment variables.
 *   AI_PROVIDER=gemini  uses GEMINI_API_KEY (and optional GEMINI_MODEL)
 *   AI_PROVIDER=mock    offline, no network and no key
 * With no AI_PROVIDER set, Gemini is used when a key is present, otherwise the mock.
 */
export function createProviderFromEnv(env: Record<string, string | undefined>): AiProvider {
  const choice = (env.AI_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : 'mock')).toLowerCase();
  if (choice === 'mock') return new MockProvider();
  if (choice === 'gemini') {
    return new GeminiProvider({ apiKey: env.GEMINI_API_KEY ?? '', model: env.GEMINI_MODEL });
  }
  throw new ProviderError('not_configured', `Unknown AI_PROVIDER "${choice}". Use "gemini" or "mock".`);
}
