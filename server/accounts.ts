import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { AccountUser } from '../lib/account/contracts.ts';
import { inTransaction, type Db } from './db.ts';

/**
 * Accounts, sign-in sessions, password reset codes and beta invites.
 *
 * - Passwords are stored only as salted scrypt hashes.
 * - A session is a random 256-bit token. The database holds its SHA-256, so a
 *   copy of the database cannot be used to sign in as anyone.
 * - The owner role comes from server configuration (OWNER_EMAIL plus a setup
 *   code), never from anything a browser sends.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const SESSION_TOUCH_MS = 5 * 60_000;
const RESET_TTL_MS = 60 * 60_000;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export class AccountError extends Error {
  code:
    | 'email_taken'
    | 'invalid_credentials'
    | 'suspended'
    | 'registration_closed'
    | 'invite_required'
    | 'invalid_invite'
    | 'invalid_reset'
    | 'not_found';

  constructor(code: AccountError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'AccountError';
  }
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  pw_hash: string;
  role: 'student' | 'owner';
  status: 'active' | 'suspended';
  beta: number;
  created_at: number;
  last_login_at: number | null;
  login_count: number;
  last_seen_at: number | null;
  invite_code: string | null;
  note: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // Parameters come from our own database, but are still bounded before use.
  if (![n, r, p].every(Number.isInteger) || n < 1024 || n > 1 << 17 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  const expected = Buffer.from(parts[5], 'base64');
  const actual = await scryptAsync(password, Buffer.from(parts[4], 'base64'), n, r, p, expected.length || 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Compares two secrets without leaking where they differ. */
export function secretsMatch(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export const toAccountUser = (u: UserRow): AccountUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  beta: u.beta === 1,
  createdAt: u.created_at,
});

export interface AccountsOptions {
  /** The address that becomes the owner account. Empty means no owner can be created. */
  ownerEmail?: string;
  /** Secret that must be given when the owner address registers. */
  ownerSetupCode?: string;
  now?: () => number;
}

export class Accounts {
  private db: Db;
  private ownerEmail: string;
  private ownerSetupCode: string;
  private now: () => number;
  /** A real hash to compare against when the address is unknown, so both cases take the same time. */
  private dummyHash: Promise<string>;

  constructor(db: Db, options: AccountsOptions = {}) {
    this.db = db;
    this.ownerEmail = normalizeEmail(options.ownerEmail ?? '');
    this.ownerSetupCode = options.ownerSetupCode ?? '';
    this.now = options.now ?? Date.now;
    this.dummyHash = hashPassword(randomBytes(12).toString('hex'));
  }

  byId(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  byEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) as UserRow | undefined;
  }

  async register(input: {
    email: string;
    name: string;
    password: string;
    inviteCode?: string;
    mode: 'open' | 'invite' | 'closed';
  }): Promise<UserRow> {
    const email = normalizeEmail(input.email);
    const code = (input.inviteCode ?? '').trim();
    const isOwner = this.ownerEmail !== '' && email === this.ownerEmail;
    if (isOwner) {
      // Nobody can claim the owner address without the setup code from the server's configuration.
      if (!this.ownerSetupCode || !secretsMatch(code, this.ownerSetupCode)) {
        throw new AccountError('invalid_invite', 'This address needs the owner setup code.');
      }
    } else if (input.mode === 'closed') {
      throw new AccountError('registration_closed', 'Registration is closed at the moment.');
    } else if (input.mode === 'invite' && !code) {
      throw new AccountError('invite_required', 'An invite code is needed to join the beta.');
    }
    if (this.byEmail(email)) throw new AccountError('email_taken', 'An account with this email already exists.');

    const pwHash = await hashPassword(input.password);
    const id = `u_${randomBytes(9).toString('base64url')}`;
    const t = this.now();
    return inTransaction(this.db, () => {
      let invite: string | null = null;
      if (!isOwner && code) {
        // Claimed inside the transaction, so a single-use code cannot be used twice at once.
        const used = this.db
          .prepare('UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked_at IS NULL AND uses < max_uses')
          .run(code);
        if (used.changes === 1) invite = code;
        else if (input.mode === 'invite') throw new AccountError('invalid_invite', 'This invite code is not valid or has been used up.');
      }
      try {
        this.db
          .prepare(
            `INSERT INTO users (id, email, name, pw_hash, role, status, beta, created_at, invite_code)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          )
          .run(id, email, input.name.trim(), pwHash, isOwner ? 'owner' : 'student', invite ? 1 : 0, t, invite);
      } catch {
        throw new AccountError('email_taken', 'An account with this email already exists.');
      }
      return this.byId(id)!;
    });
  }

  /** Checks an email and password. Unknown address and wrong password are indistinguishable to the caller. */
  async authenticate(email: string, password: string): Promise<UserRow> {
    const user = this.byEmail(email);
    const ok = await verifyPassword(password, user?.pw_hash ?? (await this.dummyHash));
    if (!user || !ok) throw new AccountError('invalid_credentials', 'The email or password is not correct.');
    if (user.status !== 'active') throw new AccountError('suspended', 'This account has been suspended. Contact the site owner.');
    return user;
  }

  recordLogin(userId: string) {
    const t = this.now();
    this.db.prepare('UPDATE users SET last_login_at = ?, last_seen_at = ?, login_count = login_count + 1 WHERE id = ?').run(t, t, userId);
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    this.db
      .prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), userId, t, t + SESSION_TTL_MS, t);
    // Old expired rows are cleared as new sessions are made.
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(t);
    return token;
  }

  /** The signed-in user for a token, or undefined. Suspended accounts never resolve. */
  userForToken(token: string): UserRow | undefined {
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return undefined;
    const hash = sha256(token);
    const t = this.now();
    const session = this.db.prepare('SELECT user_id, expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ?').get(hash) as
      | { user_id: string; expires_at: number; last_seen_at: number }
      | undefined;
    if (!session || session.expires_at <= t) return undefined;
    const user = this.byId(session.user_id);
    if (!user || user.status !== 'active') return undefined;
    if (t - session.last_seen_at > SESSION_TOUCH_MS) {
      this.db.prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(t, t + SESSION_TTL_MS, hash);
      this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(t, user.id);
    }
    return user;
  }

  endSession(token: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
  }

  /** Signs the account out everywhere, optionally keeping the session that asked. */
  revokeSessions(userId: string, exceptToken?: string): number {
    const result = exceptToken
      ? this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256(exceptToken))
      : this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
    return Number(result.changes);
  }

  async setPassword(userId: string, password: string) {
    this.db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword(password), userId);
  }

  setName(userId: string, name: string) {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), userId);
  }

  /** A one-time code the owner hands to a student who forgot their password. Shown once, stored hashed. */
  createResetCode(userId: string): { code: string; expiresAt: number } {
    const code = randomBytes(9).toString('base64url');
    const t = this.now();
    this.db.prepare('DELETE FROM reset_codes WHERE user_id = ? OR expires_at <= ?').run(userId, t);
    this.db
      .prepare('INSERT INTO reset_codes (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(code), userId, t, t + RESET_TTL_MS);
    return { code, expiresAt: t + RESET_TTL_MS };
  }

  async resetPassword(email: string, code: string, password: string): Promise<UserRow> {
    const fail = new AccountError('invalid_reset', 'This reset code is not valid or has expired.');
    const user = this.byEmail(email);
    const pwHash = await hashPassword(password);
    if (!user) throw fail;
    const t = this.now();
    const claimed = this.db
      .prepare('UPDATE reset_codes SET used_at = ? WHERE code_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?')
      .run(t, sha256(code.trim()), user.id, t);
    if (claimed.changes !== 1) throw fail;
    this.db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pwHash, user.id);
    this.revokeSessions(user.id);
    return user;
  }

  createInvite(note: string, maxUses: number): string {
    const code = `UNA-${randomBytes(5).toString('hex').toUpperCase()}`;
    this.db.prepare('INSERT INTO invites (code, note, max_uses, created_at) VALUES (?, ?, ?, ?)').run(code, note, maxUses, this.now());
    return code;
  }

  /** Removes the account and everything stored for it (foreign keys cascade). Activity rows are detached, not kept under the id. */
  deleteUser(userId: string) {
    inTransaction(this.db, () => {
      this.db.prepare('UPDATE visits SET user_id = NULL WHERE user_id = ?').run(userId);
      this.db.prepare('UPDATE events SET user_id = NULL WHERE user_id = ?').run(userId);
      this.db.prepare('UPDATE ai_requests SET user_id = NULL WHERE user_id = ?').run(userId);
      // Measured time stays in the platform totals, but no longer under this account.
      this.db
        .prepare(
          `INSERT INTO activity (day, visitor_id, user_key, active_ms, study_ms)
           SELECT day, visitor_id, '', active_ms, study_ms FROM activity WHERE user_key = ?
           ON CONFLICT (day, visitor_id, user_key) DO UPDATE SET
             active_ms = active_ms + excluded.active_ms, study_ms = study_ms + excluded.study_ms`,
        )
        .run(userId);
      this.db.prepare('DELETE FROM activity WHERE user_key = ?').run(userId);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
  }
}
