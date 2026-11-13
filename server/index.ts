import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { createProviderFromEnv } from './providers/index.ts';
import { parseOrigins } from './security.ts';

/**
 * Local entry point: `npm run server`.
 * Reads settings from the environment (or a git-ignored `.env` file). Not deployed anywhere.
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

const app = createApp({
  provider,
  allowedOrigins,
  allowNoOrigin: env.ALLOW_NO_ORIGIN === 'true',
  rateLimit: { max: Number(env.RATE_LIMIT_MAX) || 6, windowMs: 10 * 60_000 },
  dailyGenerationCap: Number(env.DAILY_GENERATION_CAP) || 200,
  log: (line) => console.log(`[lessons] ${line}`),
});

createServer(app).listen(port, host, () => {
  console.log(`[lessons] listening on http://${host}:${port}`);
  console.log(`[lessons] provider: ${provider.id} (${provider.model})`);
  console.log(`[lessons] allowed origins: ${allowedOrigins.join(', ')}`);
  if (provider.id === 'mock') {
    console.log('[lessons] No GEMINI_API_KEY set: running in offline sample mode (no AI calls).');
  }
});
