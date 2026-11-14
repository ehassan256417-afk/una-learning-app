'use client';

import { AlertTriangle, ArrowLeft, LogIn, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/account/client';
import { useSession } from '@/lib/account/session';
import { LionMascot } from './LionMascot';

type Kind = 'login' | 'register' | 'reset';

const TITLES: Record<Kind, { title: string; lead: string; submit: string }> = {
  login: { title: 'Welcome back', lead: 'Sign in to pick up where you stopped.', submit: 'Sign in' },
  register: { title: 'Create your account', lead: 'Your courses and progress are saved to it and follow you to any device.', submit: 'Create account' },
  reset: { title: 'Set a new password', lead: 'Enter the one-time reset code you were given.', submit: 'Save new password' },
};

/** Sign-in, registration and password reset share one screen layout. */
export function AuthView({ kind }: { kind: Kind }) {
  const { signIn, register, resetPassword, config, offline } = useSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const text = TITLES[kind];
  const inviteOnly = config.registration === 'invite';
  const closed = kind === 'register' && config.registration === 'closed';
  const codeVisible = kind === 'reset' || (kind === 'register' && (inviteOnly || showCode));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (kind !== 'login' && password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'login') await signIn(email, password);
      else if (kind === 'register') await register({ email, name, password, inviteCode: code.trim() || undefined });
      else await resetPassword({ email, code, password });
      // The shell sends a signed-in student to their dashboard.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <main className="screen authscreen">
      <Link href="/" className="authback">
        <ArrowLeft size={18} /> Home
      </Link>
      <div className="authhead">
        <LionMascot size={72} />
        <h1>{text.title}</h1>
        <p>{text.lead}</p>
      </div>

      <form className="card authcard" onSubmit={submit} noValidate>
        {offline && (
          <div className="note note-warn" role="status">
            <AlertTriangle size={18} />
            <span>The service cannot be reached right now. Check your connection and try again.</span>
          </div>
        )}
        {closed && (
          <div className="note note-warn" role="status">
            <AlertTriangle size={18} />
            <span>New registrations are closed at the moment.</span>
          </div>
        )}
        {error && (
          <div className="note note-error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {kind === 'register' && (
          <label className="field">
            <span>Your name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required placeholder="First name is fine" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" required inputMode="email" />
        </label>
        {codeVisible && (
          <label className="field">
            <span>{kind === 'reset' ? 'Reset code' : 'Invite code'}</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} autoComplete="off" required={kind === 'reset' || inviteOnly} />
          </label>
        )}
        <label className="field">
          <span>{kind === 'login' ? 'Password' : kind === 'reset' ? 'New password' : 'Password (8 characters or more)'}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={200}
            autoComplete={kind === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </label>

        <button type="submit" className="btn btn-gold btn-xl gap-top" disabled={busy || closed}>
          {kind === 'register' ? <UserPlus size={20} /> : <LogIn size={20} />} {busy ? 'One moment…' : text.submit}
        </button>

        {kind === 'register' && !inviteOnly && !showCode && (
          <button type="button" className="textlink center" onClick={() => setShowCode(true)}>
            I have an invite code
          </button>
        )}
        {kind === 'register' && (
          <p className="muted">
            Only the text of the files you upload is sent to our lesson service. We measure how the app is used (pages opened, time
            spent studying) to improve it. You can export or delete your account at any time from your profile.
          </p>
        )}
      </form>

      <div className="authlinks">
        {kind === 'login' && (
          <>
            {config.registration !== 'closed' && (
              <p>
                New here? <Link href="/register">Create an account</Link>
              </p>
            )}
            <p>
              Forgot your password? Ask the site owner for a reset code
              {config.site.supportEmail ? ` (${config.site.supportEmail})` : ''}, then <Link href="/reset">set a new password</Link>.
            </p>
          </>
        )}
        {kind !== 'login' && (
          <p>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        )}
      </div>
    </main>
  );
}
