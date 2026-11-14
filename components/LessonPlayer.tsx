'use client';

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleHelp,
  Layers,
  Lock,
  Repeat,
  RotateCcw,
  Star,
  Trophy,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { coursePath, sectionPath } from '@/lib/learning/links';
import type { Course, LearningLevel, Section } from '@/lib/learning/types';
import { LEVEL_LABELS, isDemo, sourceUnit } from '@/lib/learning/types';
import { answerQuiz, itemKey, quizScore, startQuiz, type Grade, type GradeEntry } from '@/lib/progress/mastery';
import { sectionKey, sectionStatuses, useProgress } from '@/lib/progress/store';
import { LionMascot } from './LionMascot';
import { SourceFigures } from './SourceFigures';
import { DemoTag, ProgressBar, RichText, SourceLine } from './ui';

type Stage = 'notes' | 'quiz' | 'cards' | 'done';
const LEVELS: LearningLevel[] = [1, 2, 3];
const LEVEL_ICONS = { 1: BookOpen, 2: Layers, 3: Trophy } as const;
/** Adaptive lessons label each note with the part of the explanation it gives. */
const ASPECT_LABELS = { what: 'What it is', why: 'Why it matters', how: 'How it works', example: 'Example' } as const;
/** Self-ratings for a flashcard, and what each does to its next review. */
const RATINGS: Array<{ grade: Grade; label: string; hint: string }> = [
  { grade: 'again', label: 'Again', hint: 'Did not know it' },
  { grade: 'good', label: 'Good', hint: 'Knew it' },
  { grade: 'easy', label: 'Easy', hint: 'Knew it at once' },
];

export function LessonPlayer({ course, section, index }: { course: Course; section: Section; index: number }) {
  const { state, ready, completeSection, gradeItems } = useProgress();
  // Questions run easiest level first.
  const questions = useMemo(() => [...section.questions].sort((a, b) => a.level - b.level), [section.questions]);
  const cards = section.flashcards;

  const [stage, setStage] = useState<Stage>('notes');
  const [noteIdx, setNoteIdx] = useState(0);
  /** Which questions are still to be answered. A missed question returns at the end. */
  const [run, setRun] = useState(() => startQuiz(questions.length));
  const [picked, setPicked] = useState<number | null>(null);
  /** The question just checked, kept on screen with its feedback until the student moves on. */
  const [shown, setShown] = useState<{ index: number; choice: number; retry: boolean } | null>(null);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [ratings, setRatings] = useState<Record<number, Grade>>({});
  const [awarded, setAwarded] = useState<number | null>(null);

  const ids = course.sections.map((s) => s.id);
  const locked = ready && stage !== 'done' && sectionStatuses(course.id, ids, state)[index] === 'locked';
  const pathHref = coursePath(course);
  const exitHref = sectionPath(course, section.id);
  const next = course.sections[index + 1];
  const unit = sourceUnit(course);
  const sourceName = course.sourceKind === 'pptx' ? 'slides' : 'PDF';
  const documentId = section.provenance.kind === 'pdf' ? section.provenance.documentId : undefined;

  const cleared = questions.length - run.queue.length;
  const attempted = run.firstTry.filter((v) => v !== null).length;
  const quizDone = run.queue.length === 0;
  const score = quizScore(run);
  const currentIdx = shown ? shown.index : run.queue[0];
  const q = currentIdx === undefined ? undefined : questions[currentIdx];
  const checked = shown !== null;
  const chosen = shown ? shown.choice : picked;
  const isRetry = shown ? shown.retry : currentIdx !== undefined && run.firstTry[currentIdx] !== null;

  const totalSteps = section.notes.length + questions.length + 1;
  const stepsDone =
    stage === 'done' ? totalSteps : Math.min(totalSteps - 1, (stage === 'notes' ? noteIdx : section.notes.length) + cleared);
  const progressPct = Math.round((stepsDone / totalSteps) * 100);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage, currentIdx, noteIdx]);

  const levelState = (lv: LearningLevel): 'done' | 'current' | 'locked' => {
    const idxs = questions.map((x, i) => (x.level === lv ? i : -1)).filter((i) => i >= 0);
    if (stage === 'done' || (idxs.length > 0 && idxs.every((i) => !run.queue.includes(i)))) return 'done';
    const firstOpen = LEVELS.find((l) => run.queue.some((i) => questions[i].level === l));
    return firstOpen === lv ? 'current' : 'locked';
  };

  const check = () => {
    if (picked === null || q === undefined || currentIdx === undefined) return;
    setShown({ index: currentIdx, choice: picked, retry: run.firstTry[currentIdx] !== null });
    setRun(answerQuiz(run, picked === q.answerIndex));
  };

  const finish = (finalRatings: Record<number, Grade>) => {
    const earned = questions.reduce((sum, x, i) => sum + (run.firstTry[i] ? x.xp : 0), 0) + section.xpReward;
    // A question missed on the first try is due again today, even though it was corrected in the lesson.
    const grades: GradeEntry[] = [
      ...questions.map((x, i) => ({
        key: itemKey(course.id, section.id, x.id),
        grade: (run.firstTry[i] ? 'good' : 'again') as Grade,
      })),
      ...cards.map((c, i) => ({ key: itemKey(course.id, section.id, c.id), grade: finalRatings[i] ?? 'good' })),
    ];
    setAwarded(completeSection(sectionKey(course.id, section.id), { score, total: questions.length, xp: earned }));
    gradeItems(grades);
    setStage('done');
  };

  const afterQuestion = () => {
    setShown(null);
    setPicked(null);
    if (!quizDone) return;
    if (cards.length === 0) finish(ratings);
    else {
      setStage('cards');
      setCardIdx(0);
      setFlipped(false);
    }
  };

  const rate = (grade: Grade) => {
    const nextRatings = { ...ratings, [cardIdx]: grade };
    setRatings(nextRatings);
    setFlipped(false);
    if (cardIdx < cards.length - 1) setCardIdx(cardIdx + 1);
    else if (quizDone) finish(nextRatings);
    else setStage('quiz');
  };

  const restart = () => {
    setStage('notes');
    setNoteIdx(0);
    setRun(startQuiz(questions.length));
    setPicked(null);
    setShown(null);
    setCardIdx(0);
    setFlipped(false);
    setRatings({});
    setAwarded(null);
  };

  if (locked) {
    return (
      <main className="screen lesson">
        <div className="lockedscreen">
          <span className="lockedscreen-ico">
            <Lock size={30} />
          </span>
          <h1>This section is locked</h1>
          <p>Finish the earlier sections in {course.code} to unlock “{section.title}”.</p>
          <Link href={pathHref} className="btn btn-gold">
            Back to learning path
          </Link>
        </div>
      </main>
    );
  }

  const note = section.notes[noteIdx];
  const card = cards[cardIdx];
  const demo = isDemo(section.provenance);
  const missedFirst = run.firstTry.filter((v) => v === false).length;
  const cardsAgain = Object.values(ratings).filter((g) => g === 'again').length;
  const dueToday = missedFirst + cardsAgain;
  const tabs = [
    ['notes', 'Lesson', BookOpen],
    ['quiz', 'Quiz', CircleHelp],
    ...(cards.length > 0 ? ([['cards', 'Flashcards', Layers]] as const) : []),
  ] as const;

  return (
    <main className="screen lesson">
      <header className="lessonhead">
        <div className="lessonhead-row">
          <Link href={stage === 'done' ? pathHref : exitHref} className="iconbtn" aria-label="Exit lesson">
            <X size={22} />
          </Link>
          <div className="lessonhead-title">
            <small>
              {course.code} • Section {index + 1}
            </small>
            <b>{section.title}</b>
          </div>
          {demo ? <DemoTag /> : <span className="demotag pdftag">Your {sourceName}</span>}
        </div>
        <ProgressBar value={progressPct} label="Lesson progress" />
        <div className="levels" aria-label="Learning levels">
          {LEVELS.map((lv) => {
            const st = levelState(lv);
            const Icon = LEVEL_ICONS[lv];
            return (
              <div key={lv} className={`level level-${st}`}>
                <span className="level-ico">{st === 'done' ? <Check size={16} strokeWidth={3.4} /> : <Icon size={16} />}</span>
                <span>
                  <b>{LEVEL_LABELS[lv].title}</b>
                  <small>{LEVEL_LABELS[lv].subtitle}</small>
                </span>
                {st === 'locked' && <Lock size={12} className="level-lock" />}
              </div>
            );
          })}
        </div>
      </header>

      {stage !== 'done' && (
        <div className="tabs" role="tablist" aria-label="Lesson parts">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={stage === id}
              className={stage === id ? 'current' : ''}
              onClick={() => {
                setStage(id);
                // A checked answer stays recorded; only the unconfirmed pick is cleared.
                if (!shown) setPicked(null);
                setFlipped(false);
              }}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      )}

      {stage === 'notes' && note && (
        <section className="pad lesson-body">
          <article className="card notecard">
            <small className="stepcount">
              Concept {noteIdx + 1} of {section.notes.length}
              {note.aspect && ` • ${ASPECT_LABELS[note.aspect]}`}
            </small>
            <h1>{note.title}</h1>
            <p>
              <RichText text={note.body} highlight={note.keyTerm} />
            </p>
            {note.example && (
              <pre className="terminal" aria-label="Example">
                <code>{note.example}</code>
              </pre>
            )}
            {documentId && <SourceFigures documentId={documentId} provenance={note.provenance} unit={unit} />}
            <SourceLine
              provenance={note.provenance}
              demoText="Sample content, not from an uploaded PDF"
              unit={unit}
              source={sourceName}
            />
          </article>
          <div className="dots" aria-hidden="true">
            {section.notes.map((n, i) => (
              <i key={n.id} className={i === noteIdx ? 'on' : ''} />
            ))}
          </div>
          <div className="actionbar inline">
            <button type="button" className="btn btn-outline" disabled={noteIdx === 0} onClick={() => setNoteIdx(noteIdx - 1)}>
              <ArrowLeft size={18} /> Previous
            </button>
            {noteIdx < section.notes.length - 1 ? (
              <button type="button" className="btn btn-gold" onClick={() => setNoteIdx(noteIdx + 1)}>
                Next <ArrowRight size={18} />
              </button>
            ) : (
              <button type="button" className="btn btn-gold" onClick={() => setStage('quiz')}>
                {quizDone ? 'Quiz' : 'Start Quiz'} <ArrowRight size={18} />
              </button>
            )}
          </div>
        </section>
      )}

      {stage === 'quiz' && q && (
        <section className="pad lesson-body">
          <article className="card quizcard">
            <div className="quizcard-top">
              <span className="pill pill-purple">
                <CircleHelp size={14} /> Quiz – Level {q.level}
              </span>
              {isRetry ? (
                <span className="pill pill-retry">
                  <Repeat size={14} /> Try again
                </span>
              ) : (
                <span className="pill pill-xp">
                  <Star size={14} fill="currentColor" /> +{q.xp} XP
                </span>
              )}
            </div>
            <small className="stepcount">
              {isRetry
                ? 'You missed this one earlier. Answer it correctly to finish the lesson.'
                : `Question ${checked ? attempted : attempted + 1} of ${questions.length}`}
            </small>
            <h2 id="quiz-prompt">
              <RichText text={q.prompt} />
            </h2>
            <div className="choices" role="radiogroup" aria-labelledby="quiz-prompt">
              {q.choices.map((choice, i) => {
                const isAnswer = i === q.answerIndex;
                const cls = [
                  'choice',
                  chosen === i ? 'picked' : '',
                  checked && isAnswer ? 'correct' : '',
                  checked && chosen === i && !isAnswer ? 'wrong' : '',
                ].join(' ');
                return (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={chosen === i}
                    disabled={checked}
                    className={cls}
                    onClick={() => setPicked(i)}
                  >
                    <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                    <span className="choice-text">
                      <RichText text={choice} />
                    </span>
                    {checked && isAnswer && <CheckCircle2 size={22} className="choice-mark" />}
                    {checked && chosen === i && !isAnswer && <XCircle size={22} className="choice-mark" />}
                    {!checked && chosen === i && (
                      <span className="choice-check">
                        <Check size={14} strokeWidth={3.4} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {checked && (
              <div className={`feedback ${chosen === q.answerIndex ? 'good' : 'bad'}`} role="status">
                <b>
                  {chosen === q.answerIndex
                    ? shown?.retry
                      ? 'Correct. You fixed it.'
                      : `Correct! +${q.xp} XP`
                    : 'Not quite. This question will come back before the lesson ends.'}
                </b>
                <p>
                  <RichText text={q.explanation} />
                </p>
                <SourceLine
                  provenance={q.provenance}
                  demoText="Sample question, not checked against a PDF"
                  unit={unit}
                  source={sourceName}
                />
              </div>
            )}
          </article>
          <div className="actionbar inline">
            <button type="button" className="btn btn-outline" onClick={() => setStage('notes')}>
              <ArrowLeft size={18} /> Lesson
            </button>
            {!checked ? (
              <button type="button" className="btn btn-gold" disabled={picked === null} onClick={check}>
                Check Answer
              </button>
            ) : (
              <button type="button" className="btn btn-gold" onClick={afterQuestion}>
                {!quizDone ? 'Next Question' : cards.length > 0 ? 'Flashcards' : 'Finish Lesson'} <ArrowRight size={18} />
              </button>
            )}
          </div>
        </section>
      )}

      {stage === 'quiz' && !q && (
        <section className="pad lesson-body">
          <article className="card quizcard">
            <small className="stepcount">Quiz complete</small>
            <h2>
              {score} of {questions.length} correct on the first try
            </h2>
            <p className="muted">
              {missedFirst > 0
                ? `You corrected ${missedFirst === 1 ? 'the one you missed' : `all ${missedFirst} you missed`}. ${missedFirst === 1 ? 'It comes' : 'They come'} back in today's review.`
                : 'Every answer was right the first time.'}
            </p>
          </article>
          <div className="actionbar inline">
            <button type="button" className="btn btn-outline" onClick={() => setStage('notes')}>
              <ArrowLeft size={18} /> Lesson
            </button>
            <button type="button" className="btn btn-gold" onClick={() => (cards.length > 0 ? setStage('cards') : finish(ratings))}>
              {cards.length > 0 ? 'Flashcards' : 'Finish Lesson'} <ArrowRight size={18} />
            </button>
          </div>
        </section>
      )}

      {stage === 'cards' && card && (
        <section className="pad lesson-body">
          <small className="stepcount center">
            Card {cardIdx + 1} of {cards.length} • say the answer to yourself, then flip
          </small>
          <button
            type="button"
            className={`flashcard ${flipped ? 'flipped' : ''}`}
            onClick={() => setFlipped(!flipped)}
            aria-label={flipped ? `Answer: ${card.back}. Tap to show the term.` : `Term: ${card.front}. Tap to show the answer.`}
          >
            <span className="flash-face flash-front">
              <small>TERM</small>
              <b>{card.front}</b>
              <em>
                <RotateCcw size={14} /> Tap to flip
              </em>
            </span>
            <span className="flash-face flash-back">
              <small>MEANING</small>
              <b>{card.back}</b>
              {isDemo(card.provenance) ? (
                <DemoTag />
              ) : (
                card.provenance.citations[0] && (
                  <span className="pagechip">
                    {unit === 'slide' ? 'Slide' : 'Page'} {card.provenance.citations[0].page}
                  </span>
                )
              )}
            </span>
          </button>
          <div className="dots" aria-hidden="true">
            {cards.map((f, i) => (
              <i key={f.id} className={i === cardIdx ? 'on' : ''} />
            ))}
          </div>
          {flipped ? (
            <>
              <p className="ratehint" id="rate-label">
                How well did you know it? Your answer sets when this card comes back.
              </p>
              <div className="ratings" role="group" aria-labelledby="rate-label">
                {RATINGS.map((r) => (
                  <button key={r.grade} type="button" className={`btn rate rate-${r.grade}`} onClick={() => rate(r.grade)}>
                    <b>{r.label}</b>
                    <small>{r.hint}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="actionbar inline">
              <button
                type="button"
                className="btn btn-outline"
                disabled={cardIdx === 0}
                onClick={() => {
                  setCardIdx(cardIdx - 1);
                  setFlipped(false);
                }}
              >
                <ArrowLeft size={18} /> Previous
              </button>
              <button type="button" className="btn btn-gold" onClick={() => setFlipped(true)}>
                Show Answer <RotateCcw size={18} />
              </button>
            </div>
          )}
        </section>
      )}

      {stage === 'done' && (
        <section className="pad lesson-body">
          <div className="celebrate">
            <span className="confetti c1" />
            <span className="confetti c2" />
            <span className="confetti c3" />
            <span className="confetti c4" />
            <div>
              <h1>
                {score * 2 >= questions.length ? 'Great job, ' : 'Keep going, '}
                <span>Lion!</span>
              </h1>
              <p>
                <CheckCircle2 size={20} />
                <span>
                  You finished <strong>Section {index + 1}</strong>.
                </span>
              </p>
              <div className="celebrate-pills">
                <span className="pill pill-xp-dark">
                  <Star size={14} fill="currentColor" /> {awarded ? `+${awarded} XP` : 'Review complete'}
                </span>
                <span className="pill pill-outline">
                  <Check size={14} strokeWidth={3} /> {score}/{questions.length} first try
                </span>
              </div>
            </div>
            <LionMascot size={112} className="celebrate-lion" />
          </div>

          <div className="card reviewplan">
            <h2>
              <CalendarClock size={20} className="c-purple" /> What happens next
            </h2>
            <p>
              {dueToday > 0 ? (
                <>
                  <b>
                    {dueToday} item{dueToday === 1 ? '' : 's'} you missed {dueToday === 1 ? 'is' : 'are'} ready to review
                    again today.
                  </b>{' '}
                  Everything else comes back tomorrow, then at longer gaps each time you remember it.
                </>
              ) : (
                <>
                  <b>These questions and cards come back for review tomorrow</b>, then at longer gaps each time you
                  remember them. Recalling them later is what makes them stick.
                </>
              )}
            </p>
            {dueToday > 0 && (
              <Link href="/review" className="btn btn-outline">
                <Repeat size={18} /> Review missed items
              </Link>
            )}
          </div>

          <div className="card">
            <h2>Your answers</h2>
            <ul className="review">
              {questions.map((x, i) => {
                const right = run.firstTry[i] === true;
                return (
                  <li key={x.id} className={right ? 'right' : 'miss'}>
                    {right ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                    <span>
                      <b>
                        <RichText text={x.prompt} />
                      </b>
                      <small>
                        Answer: <RichText text={x.choices[x.answerIndex]} />
                        {!right && ' (missed at first, then corrected)'}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
            {awarded === 0 && <p className="muted">XP was already earned for this section, so this run counted as review.</p>}
          </div>

          <div className="actionbar inline stackable">
            <button type="button" className="btn btn-outline" onClick={restart}>
              <RotateCcw size={18} /> Retry
            </button>
            {next ? (
              <Link href={sectionPath(course, next.id)} className="btn btn-gold">
                Continue to Section {index + 2} <ArrowRight size={18} />
              </Link>
            ) : (
              <Link href={pathHref} className="btn btn-gold">
                Back to Learning Path <ArrowRight size={18} />
              </Link>
            )}
          </div>
          {next && (
            <Link href={pathHref} className="textlink center">
              Back to learning path
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
