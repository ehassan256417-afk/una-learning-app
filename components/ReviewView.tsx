'use client';

import { ArrowRight, CalendarClock, Check, CheckCircle2, CircleHelp, Layers, Repeat, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStudyCourses } from '@/lib/learning/generated-store';
import { sourceUnit } from '@/lib/learning/types';
import { dayIndex, describeDue, dueItems, nextDueDay, type Grade, type ReviewItem } from '@/lib/progress/mastery';
import { useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';
import { ProgressBar, RichText, SourceLine } from './ui';

/** Items in one sitting. Short sessions get finished; long ones get abandoned. */
const SESSION_SIZE = 15;
/** XP for recalling a due item. Small on purpose: review is its own reward, lessons carry the XP. */
const XP_PER_RECALL = 2;

const RATINGS: Array<{ grade: Grade; label: string; hint: string }> = [
  { grade: 'again', label: 'Again', hint: 'Did not know it' },
  { grade: 'good', label: 'Good', hint: 'Knew it' },
  { grade: 'easy', label: 'Easy', hint: 'Knew it at once' },
];

interface Session {
  /** Items still to practise; the first is on screen. A missed item is added to the end again. */
  queue: ReviewItem[];
  total: number;
  /** Keys recalled on the first attempt in this session, and keys missed at least once. */
  recalled: string[];
  missed: string[];
}

export function ReviewView() {
  const { state, ready, gradeItems } = useProgress();
  const courses = useStudyCourses();
  const [session, setSession] = useState<Session | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const today = dayIndex(new Date());
  const due = ready ? dueItems(courses, state.review, today) : [];
  const item = session?.queue[0];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [item?.key, session?.queue.length]);

  const start = () => {
    const queue = due.slice(0, SESSION_SIZE);
    setSession({ queue, total: queue.length, recalled: [], missed: [] });
    setPicked(null);
    setChecked(false);
    setFlipped(false);
  };

  /** Saves the grade straight away, so leaving mid-session loses nothing. */
  const grade = (g: Grade) => {
    if (!session || !item) return;
    const firstAttempt = !session.recalled.includes(item.key) && !session.missed.includes(item.key);
    gradeItems([{ key: item.key, grade: g }], g === 'again' ? 0 : XP_PER_RECALL);
    const [, ...rest] = session.queue;
    setSession({
      ...session,
      queue: g === 'again' ? [...rest, item] : rest,
      recalled: g !== 'again' && firstAttempt ? [...session.recalled, item.key] : session.recalled,
      missed: g === 'again' && firstAttempt ? [...session.missed, item.key] : session.missed,
    });
    setPicked(null);
    setChecked(false);
    setFlipped(false);
  };

  const finished = session !== null && session.queue.length === 0;
  const nextDay = ready ? nextDueDay(courses, state.review) : null;
  // Items cleared so far: a missed item counts only once it has been answered correctly.
  const cleared = session ? session.total - new Set(session.queue.map((x) => x.key)).size : 0;

  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader backHref="/" backLabel="Back to home" />
        <div className="hero-title">
          <h1>Review</h1>
          <p>Recall what you learned before you forget it. A few minutes a day is enough.</p>
        </div>
      </section>

      <div className="pad pad-top">
        {!ready && (
          <div className="card statuscard" role="status">
            <span className="spinner" aria-hidden="true" />
            <div>
              <b>Loading your review list…</b>
            </div>
          </div>
        )}

        {ready && !session && due.length > 0 && (
          <div className="card reviewintro">
            <h2>
              <Repeat size={20} className="c-purple" /> {due.length} item{due.length === 1 ? '' : 's'} due
            </h2>
            <p>
              These are questions and flashcards from lessons you finished. Items you missed come first. Each one you
              remember moves to a longer gap: 1 day, then 3, 7, 16 and 35.
            </p>
            <button type="button" className="btn btn-gold btn-xl" onClick={start}>
              Start review{due.length > SESSION_SIZE ? ` (first ${SESSION_SIZE})` : ''} <ArrowRight size={20} />
            </button>
          </div>
        )}

        {ready && !session && due.length === 0 && (
          <div className="card reviewintro">
            <h2>
              <CheckCircle2 size={20} className="c-green" /> Nothing due right now
            </h2>
            <p>
              {nextDay === null
                ? 'Finish a lesson and its questions and flashcards will come back here for review, starting the next day.'
                : `Your next review is ${describeDue(nextDay, today)}. Coming back then, not sooner, is what makes it work.`}
            </p>
            <Link href="/courses" className="btn btn-gold">
              Go to courses <ArrowRight size={18} />
            </Link>
          </div>
        )}

        {session && item && (
          <>
            <div className="reviewbar">
              <ProgressBar value={Math.round((cleared / session.total) * 100)} tone="purple" label="Review progress" />
              <small>
                {session.queue.length} left • {item.course.title}
              </small>
            </div>

            {item.kind === 'question' && (
              <>
                <article className="card quizcard">
                  <div className="quizcard-top">
                    <span className="pill pill-purple">
                      <CircleHelp size={14} /> {item.section.title}
                    </span>
                    {item.record.box === 0 && (
                      <span className="pill pill-retry">
                        <Repeat size={14} /> Missed before
                      </span>
                    )}
                  </div>
                  <h2 id="review-prompt">
                    <RichText text={item.question.prompt} />
                  </h2>
                  <div className="choices" role="radiogroup" aria-labelledby="review-prompt">
                    {item.question.choices.map((choice, i) => {
                      const isAnswer = i === item.question.answerIndex;
                      const cls = [
                        'choice',
                        picked === i ? 'picked' : '',
                        checked && isAnswer ? 'correct' : '',
                        checked && picked === i && !isAnswer ? 'wrong' : '',
                      ].join(' ');
                      return (
                        <button
                          key={choice}
                          type="button"
                          role="radio"
                          aria-checked={picked === i}
                          disabled={checked}
                          className={cls}
                          onClick={() => setPicked(i)}
                        >
                          <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                          <span className="choice-text">
                            <RichText text={choice} />
                          </span>
                          {checked && isAnswer && <CheckCircle2 size={22} className="choice-mark" />}
                          {checked && picked === i && !isAnswer && <XCircle size={22} className="choice-mark" />}
                          {!checked && picked === i && (
                            <span className="choice-check">
                              <Check size={14} strokeWidth={3.4} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {checked && (
                    <div className={`feedback ${picked === item.question.answerIndex ? 'good' : 'bad'}`} role="status">
                      <b>
                        {picked === item.question.answerIndex
                          ? 'Correct. This one moves to a longer gap.'
                          : 'Not quite. It will come back at the end of this session.'}
                      </b>
                      <p>
                        <RichText text={item.question.explanation} />
                      </p>
                      <SourceLine
                        provenance={item.question.provenance}
                        demoText="Sample question, not checked against a PDF"
                        unit={sourceUnit(item.course)}
                        source={item.course.sourceKind === 'pptx' ? 'slides' : 'PDF'}
                      />
                    </div>
                  )}
                </article>
                <div className="actionbar inline">
                  {!checked ? (
                    <button type="button" className="btn btn-gold" disabled={picked === null} onClick={() => setChecked(true)}>
                      Check Answer
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-gold"
                      onClick={() => grade(picked === item.question.answerIndex ? 'good' : 'again')}
                    >
                      Next <ArrowRight size={18} />
                    </button>
                  )}
                </div>
              </>
            )}

            {item.kind === 'flashcard' && (
              <>
                <small className="stepcount center">
                  <Layers size={13} /> {item.section.title} • say the answer to yourself, then flip
                </small>
                <button
                  type="button"
                  className={`flashcard ${flipped ? 'flipped' : ''}`}
                  onClick={() => setFlipped(!flipped)}
                  aria-label={
                    flipped ? `Answer: ${item.card.back}. Tap to show the term.` : `Term: ${item.card.front}. Tap to show the answer.`
                  }
                >
                  <span className="flash-face flash-front">
                    <small>TERM</small>
                    <b>{item.card.front}</b>
                    <em>
                      <RotateCcw size={14} /> Tap to flip
                    </em>
                  </span>
                  <span className="flash-face flash-back">
                    <small>MEANING</small>
                    <b>{item.card.back}</b>
                  </span>
                </button>
                {flipped ? (
                  <>
                    <p className="ratehint" id="review-rate-label">
                      How well did you know it?
                    </p>
                    <div className="ratings" role="group" aria-labelledby="review-rate-label">
                      {RATINGS.map((r) => (
                        <button key={r.grade} type="button" className={`btn rate rate-${r.grade}`} onClick={() => grade(r.grade)}>
                          <b>{r.label}</b>
                          <small>{r.hint}</small>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="actionbar inline">
                    <button type="button" className="btn btn-gold" onClick={() => setFlipped(true)}>
                      Show Answer <RotateCcw size={18} />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {finished && session && (
          <div className="card reviewintro">
            <h2>
              <CheckCircle2 size={20} className="c-green" /> Review done
            </h2>
            <p>
              You remembered <b>{session.recalled.length}</b> of <b>{session.total}</b> on the first try
              {session.missed.length > 0 &&
                ` and fixed the ${session.missed.length === 1 ? 'one' : session.missed.length} you missed`}
              .
            </p>
            <p className="muted">
              <CalendarClock size={14} />{' '}
              {due.length > 0
                ? `${due.length} more ${due.length === 1 ? 'item is' : 'items are'} due today.`
                : nextDay !== null
                  ? `Next review: ${describeDue(nextDay, today)}.`
                  : 'Nothing else is scheduled yet.'}
            </p>
            {due.length > 0 ? (
              <button type="button" className="btn btn-gold" onClick={start}>
                Keep reviewing <ArrowRight size={18} />
              </button>
            ) : (
              <Link href="/progress" className="btn btn-gold">
                See your progress <ArrowRight size={18} />
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
