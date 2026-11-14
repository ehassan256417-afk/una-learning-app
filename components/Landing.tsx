'use client';

import { ArrowRight, BookOpenCheck, FileUp, Layers, Quote, Repeat, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/lib/account/session';
import { LionMascot } from './LionMascot';

/** The public face of the site. It shows no student data of any kind. */

const FEATURES = [
  {
    icon: FileUp,
    title: 'Bring your own material',
    body: 'Upload a chapter as a PDF or a lecture as PowerPoint slides. The file is read on your device; only its text is used to write lessons.',
  },
  {
    icon: Layers,
    title: 'Lessons that follow the concepts',
    body: 'The material is split by concept, not by page count, into Beginner, Intermediate and Advanced lessons with notes, quizzes and flashcards.',
  },
  {
    icon: Quote,
    title: 'Every point cites its page',
    body: 'Each note and question carries a quote from your file and its page or slide number, checked automatically, so you can verify it yourself.',
  },
  {
    icon: Repeat,
    title: 'Review at the right time',
    body: 'Missed questions come back until you get them right, and spaced review brings each item back just before you would forget it.',
  },
];

const STEPS = [
  { n: '1', title: 'Create your account', body: 'Your courses and progress are private to you and follow you to any device.' },
  { n: '2', title: 'Upload a PDF or slides', body: 'A plan of the concepts is made first, then one lesson at a time.' },
  { n: '3', title: 'Study in short sessions', body: 'Read, answer, flip cards, and let the review schedule do the remembering.' },
];

export function Landing({ onTryHere }: { onTryHere?: () => void }) {
  const { config, offline } = useSession();
  const invite = config.registration === 'invite';
  const closed = config.registration === 'closed';

  const primary = onTryHere ? (
    <button type="button" className="btn btn-gold btn-xl" onClick={onTryHere}>
      Try it on this device <ArrowRight size={20} />
    </button>
  ) : closed ? (
    <Link href="/login" className="btn btn-gold btn-xl">
      Sign in <ArrowRight size={20} />
    </Link>
  ) : (
    <Link href="/register" className="btn btn-gold btn-xl">
      {invite ? 'Join the beta' : 'Create a free account'} <ArrowRight size={20} />
    </Link>
  );

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="UNA Learning home">
          <LionMascot size={40} />
          <span>
            UNA <em>Learning</em>
          </span>
        </Link>
        {!onTryHere && (
          <nav aria-label="Account">
            <Link href="/login" className="landing-link">
              Sign in
            </Link>
            {!closed && (
              <Link href="/register" className="btn btn-gold landing-cta">
                {invite ? 'Join the beta' : 'Get started'}
              </Link>
            )}
          </nav>
        )}
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-kicker">
            <Sparkles size={14} aria-hidden="true" /> Student beta
          </p>
          <h1>
            Study your own course material, <span>one short lesson at a time.</span>
          </h1>
          <p className="landing-lead">{config.site.tagline}</p>
          <div className="landing-actions">
            {primary}
            {!onTryHere && !closed && (
              <Link href="/login" className="btn btn-outline btn-xl landing-secondary">
                I already have an account
              </Link>
            )}
          </div>
          {invite && !onTryHere && <p className="landing-fine">The beta is invite-only for now. You will need an invite code to register.</p>}
          {closed && !onTryHere && <p className="landing-fine">New registrations are closed at the moment. Existing students can sign in.</p>}
          {onTryHere && (
            <p className="landing-fine">Accounts are not connected on this site yet, so everything you do stays in this browser.</p>
          )}
          {offline && (
            <p className="landing-fine landing-warn" role="status">
              <WifiOff size={14} aria-hidden="true" /> The service cannot be reached right now. Please try again in a little while.
            </p>
          )}
        </div>
        <div className="landing-hero-art" aria-hidden="true">
          <LionMascot variant="full" size={260} />
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-features">
        <h2 id="landing-features">Built for how students actually revise</h2>
        <div className="landing-grid">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="landing-card">
              <span className="landing-ico">
                <Icon size={22} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-steps" aria-labelledby="landing-how">
        <h2 id="landing-how">How it works</h2>
        <ol>
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="landing-step-n">{s.n}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-trust" aria-labelledby="landing-trust">
        <h2 id="landing-trust">Honest about what it is</h2>
        <div className="landing-grid landing-grid-2">
          <article className="landing-card">
            <span className="landing-ico">
              <ShieldCheck size={22} />
            </span>
            <h3>Your work is private</h3>
            <p>
              Each account sees only its own courses and progress. Your original file is never uploaded. The site measures how it is
              used (pages opened and time spent studying) to improve it, without advertising or third-party trackers.
            </p>
          </article>
          <article className="landing-card">
            <span className="landing-ico">
              <BookOpenCheck size={22} />
            </span>
            <h3>A study aid, not an authority</h3>
            <p>
              Lessons are written by AI from your text and checked against it automatically. That reduces mistakes but cannot rule
              them out, so confirm important points in your course material.
            </p>
          </article>
        </div>
      </section>

      <footer className="landing-footer">
        <p>
          UNA Learning is an independent student project. It is not an official University of North Alabama application and is not
          affiliated with or endorsed by the university.
        </p>
        {config.site.supportEmail && (
          <p>
            Questions? <a href={`mailto:${config.site.supportEmail}`}>{config.site.supportEmail}</a>
          </p>
        )}
      </footer>
    </div>
  );
}
