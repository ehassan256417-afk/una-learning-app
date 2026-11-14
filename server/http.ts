import type { IncomingMessage } from 'node:http';
import type { ApiErrorCode } from '../lib/learning/contracts.ts';

/** Small HTTP helpers shared by the lesson endpoints and the platform endpoints. */

export class HttpError extends Error {
  status: number;
  code: ApiErrorCode;
  headers: Record<string, string>;

  constructor(status: number, code: ApiErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        req.resume();
        reject(new HttpError(413, 'too_large', 'The request is too large to process.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => !done && resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => !done && reject(new HttpError(400, 'invalid_request', 'The request could not be read.')));
  });
}

/** Reads a size-capped JSON body. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'invalid_request', 'Send the request as JSON.');
  }
  const text = await readBody(req, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_request', 'The request body is not valid JSON.');
  }
}

/**
 * The address a request came from. Behind a reverse proxy the socket address
 * is the proxy's, so with `trustProxy` the last X-Forwarded-For entry (the one
 * the proxy itself added) is used instead. Never trust that header otherwise:
 * a client can set it to anything.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = forwarded[forwarded.length - 1];
    if (last) return last.slice(0, 64);
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** The bearer token of a request, if it sent one. */
export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
  return match?.[1];
}
