import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { Platform } from './platform.ts';
import { createProviderFromEnv } from './providers/index.ts';
import { parseOrigins } from './security.ts';

/**
 * Local entry point: `npm run server`.
 * Reads settings from the environment (or a git-ignored `.env` file). Not deployed anywhere.
 *
 * Accounts, saved learning data, measured activity and the owner dashboard are kept in a
 * SQLite file under DATA_DIR (default `data/`, git-ignored). Back that folder up.
 */

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; environment variables (if any) are used as they are.
}

const env = process.env;
const provider = createProviderFromEnv(env);
const port = Number(env.PORT) || 8787;
// Loopback only by default, so the server is not reachable from other machines.
const host = env.HOST || '127.0.0.1';
const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS, ['http://localhost:3000', 'http://127.0.0.1:3000']);

const registrationMode = (['open', 'invite', 'closed'] as const).find((m) => m === env.REGISTRATION_MODE);
const platform = new Platform({
  dbPath: `${env.DATA_DIR || 'data'}/una.db`,
  ownerEmail: env.OWNER_EMAIL,
  ownerSetupCode: env.OWNER_SETUP_CODE,
  defaults: {
    registrationMode,
    dailyAiRequests: Number(env.DAILY_GENERATION_CAP) || undefined,
    courseMaxRequests: Number(env.COURSE_MAX_REQUESTS) || undefined,
    courseMaxTokens: Number(env.COURSE_MAX_TOKENS) || undefined,
  },
});

const app = createApp({
  provider,
  platform,
  // The owner can pick another model in the dashboard; it is built with the same key and settings.
  providerFor: (model) => createProviderFromEnv(provider.id === 'gemini' ? { ...env, GEMINI_MODEL: model } : { ...env, ZRO_MODEL: model }),
  trustProxy: env.TRUST_PROXY === 'true',
  allowedOrigins,
  allowNoOrigin: env.ALLOW_NO_ORIGIN === 'true',
  rateLimit: { max: Number(env.RATE_LIMIT_MAX) || 6, windowMs: 10 * 60_000 },
  dailyGenerationCap: Number(env.DAILY_GENERATION_CAP) || 200,
  courseBudget: {
    maxRequests: Number(env.COURSE_MAX_REQUESTS) || 12,
    maxTokens: Number(env.COURSE_MAX_TOKENS) || 120_000,
  },
  planMaxTokens: Number(env.PLAN_MAX_TOKENS) || undefined,
  lessonMaxTokens: Number(env.LESSON_MAX_TOKENS) || undefined,
  log: (line) => console.log(`[lessons] ${line}`),
});

createServer(app).listen(port, host, () => {
  console.log(`[lessons] listening on http://${host}:${port}`);
  console.log(`[lessons] provider: ${provider.id} (${provider.model})`);
  console.log(`[lessons] allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[lessons] accounts: on (database in ${env.DATA_DIR || 'data'}/)`);
  if (env.OWNER_SETUP_CODE && env.OWNER_SETUP_CODE.length < 16) {
    console.log('[lessons] OWNER_SETUP_CODE is shorter than 16 characters and is ignored. Use a long random code.');
  }
  if (!env.OWNER_EMAIL || !env.OWNER_SETUP_CODE) {
    console.log('[lessons] No owner yet: set OWNER_EMAIL and OWNER_SETUP_CODE in .env, then register with that email and the code.');
  }
  if (provider.id === 'mock') {
    console.log('[lessons] No ZRO_API_KEY set: running in offline sample mode (no AI calls).');
  }
});
