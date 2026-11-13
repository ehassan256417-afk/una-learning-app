'use client';

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  CircleHelp,
  Layers,
  Lock,
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
import { LEVEL_LABELS, isDemo } from '@/lib/learning/types';
import { sectionKey, sectionStatuses, useProgress } from '@/lib/progress/store';
import { LionMascot } from './LionMascot';
import { DemoTag, ProgressBar, RichText, SourceLine } from './ui';

type Stage = 'notes' | 'quiz' | 'cards' | 'done';
const LEVELS: LearningLevel[] = [1, 2, 3];
const LEVEL_ICONS = { 1: BookOpen, 2: Layers, 3: Trophy } as const;
/** Adaptive lessons label each note with the part of the explanation it gives. */
const ASPECT_LABELS = { what: 'What it is', why: 'Why it matters', how: 'How it works', example: 'Example' } as const;

export function LessonPlayer({ course, section, index }: { course: Course; section: Section; index: number }) {
  const { state, ready, completeSection } = useProgress();
  // Questions run easiest level first.
  const questions = useMemo(() => [...section.questions].sort((a, b) => a.level - b.level), [section.questions]);

  const [stage, setStage] = useState<Stage>('notes');
  const [noteIdx, setNoteIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  /** Per question: the chosen index once checked. */
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [awarded, setAwarded] = useState<number | null>(null);

  const ids = course.sections.map((s) => s.id);
  const locked = ready && stage !== 'done' && sectionStatuses(course.id, ids, state)[index] === 'locked';
  const pathHref = coursePath(course);
  const exitHref = sectionPath(course, section.id);
  const next = course.sections[index + 1];

  const answeredCount = answers.filter((a) => a !== null).length;
  const allAnswered = answeredCount === questions.length;
  const score = answers.filter((a, i) => a === questions[i].answerIndex).length;
  const q = questions[qIdx];
  const checked = answers[qIdx] !== null;
  const chosen = checked ? answers[qIdx] : picked;

  const totalSteps = section.notes.length + questions.length + 1;
  const stepsDone =
    stage === 'done'
      ? totalSteps
      : Math.min(totalSteps - 1, (stage === 'notes' ? noteIdx : section.notes.length) + answeredCount);
  const progressPct = Math.round((stepsDone / totalSteps) * 100);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage, qIdx, noteIdx]);

  const levelState = (lv: LearningLevel): 'done' | 'current' | 'locked' => {
    const idxs = questions.map((x, i) => (x.level === lv ? i : -1)).filter((i) => i >= 0);
    if (stage === 'done' || (idxs.length > 0 && idxs.every((i) => answers[i] !== null))) return 'done';
    const firstOpen = LEVELS.find((l) => questions.some((x, i) => x.level === l && answers[i] === null));
    return firstOpen === lv ? 'current' : 'locked';
  };

  const check = () => {
    if (picked === null) return;
    setAnswers((prev) => prev.map((a, i) => (i === qIdx ? picked : a)));
  };

  const goQuestion = (i: number) => {
    setQIdx(i);
    setPicked(null);
  };

  const afterQuestion = () => {
    const nextOpen = answers.findIndex((a, i) => a === null && i !== qIdx);
    if (qIdx < questions.length - 1) goQuestion(qIdx + 1);
    else if (nextOpen >= 0) goQuestion(nextOpen);
    else {
      setStage('cards');
      setCardIdx(0);
      setFlipped(false);
    }
  };

  const finish = () => {
    const earned = questions.reduce((sum, x, i) => sum + (answers[i] === x.answerIndex ? x.xp : 0), 0) + section.xpReward;
    setAwarded(completeSection(sectionKey(course.id, section.id), { score, total: questions.length, xp: earned }));
    setStage('done');
  };

  const restart = () => {
    setStage('notes');
    setNoteIdx(0);
    setQIdx(0);
    setPicked(null);
    setAnswers(questions.map(() => null));
    setCardIdx(0);
    setFlipped(false);
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
  const card = section.flashcards[cardIdx];
  const demo = isDemo(section.provenance);

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
          {demo ? <DemoTag /> : <span className="demotag pdftag">Your PDF</span>}
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
          {(
            [
              ['notes', 'Lesson', BookOpen],
              ['quiz', 'Quiz', CircleHelp],
              ['cards', 'Flashcards', Layers],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={stage === id}
              className={stage === id ? 'current' : ''}
              onClick={() => {
                setStage(id);
                setPicked(null);
                setFlipped(false);
              }}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      )}

      {stage === 'notes' && (
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
              <pre className="terminal" aria-label="Example commands">
                <code>{note.example}</code>
              </pre>
            )}
            <SourceLine provenance={note.provenance} demoText="Sample content, not from an uploaded PDF" />
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
                Start Quiz <ArrowRight size={18} />
              </button>
            )}
          </div>
        </section>
      )}

      {stage === 'quiz' && (
        <section className="pad lesson-body">
          <article className="card quizcard">
            <div className="quizcard-top">
              <span className="pill pill-purple">
                <CircleHelp size={14} /> Quiz – Level {q.level}
              </span>
              <span className="pill pill-xp">
                <Star size={14} fill="currentColor" /> +{q.xp} XP
              </span>
            </div>
            <small className="stepcount">
              Question {qIdx + 1} of {questions.length}
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
                <b>{chosen === q.answerIndex ? `Correct! +${q.xp} XP` : 'Not quite.'}</b>
                <p>
                  <RichText text={q.explanation} />
                </p>
                <SourceLine provenance={q.provenance} demoText="Sample question, not checked against a PDF" />
              </div>
            )}
          </article>
          <div className="actionbar inline">
            <button type="button" className="btn btn-outline" onClick={() => (qIdx > 0 ? goQuestion(qIdx - 1) : setStage('notes'))}>
              <ArrowLeft size={18} /> {qIdx > 0 ? 'Previous' : 'Lesson'}
            </button>
            {!checked ? (
              <button type="button" className="btn btn-gold" disabled={picked === null} onClick={check}>
                Check Answer
              </button>
            ) : (
              <button type="button" className="btn btn-gold" onClick={afterQuestion}>
                {qIdx < questions.length - 1 ? 'Next Question' : allAnswered ? 'Flashcards' : 'Next Question'} <ArrowRight size={18} />
              </button>
            )}
          </div>
        </section>
      )}

      {stage === 'cards' && (
        <section className="pad lesson-body">
          <small className="stepcount center">
            Card {cardIdx + 1} of {section.flashcards.length} • tap the card to flip
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
                card.provenance.citations[0] && <span className="pagechip">Page {card.provenance.citations[0].page}</span>
              )}
            </span>
          </button>
          <div className="dots" aria-hidden="true">
            {section.flashcards.map((f, i) => (
              <i key={f.id} className={i === cardIdx ? 'on' : ''} />
            ))}
          </div>
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
            {cardIdx < section.flashcards.length - 1 ? (
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => {
                  setCardIdx(cardIdx + 1);
                  setFlipped(false);
                }}
              >
                Next Card <ArrowRight size={18} />
              </button>
            ) : allAnswered ? (
              <button type="button" className="btn btn-gold" onClick={finish}>
                Finish Lesson <Check size={18} strokeWidth={3} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => {
                  setStage('quiz');
                  goQuestion(Math.max(0, answers.findIndex((a) => a === null)));
                }}
              >
                Finish the Quiz <ArrowRight size={18} />
              </button>
            )}
          </div>
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
                  <Check size={14} strokeWidth={3} /> {score}/{questions.length} correct
                </span>
              </div>
            </div>
            <LionMascot size={112} className="celebrate-lion" />
          </div>

          <div className="card">
            <h2>Your answers</h2>
            <ul className="review">
              {questions.map((x, i) => {
                const right = answers[i] === x.answerIndex;
                return (
                  <li key={x.id} className={right ? 'right' : 'miss'}>
                    {right ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                    <span>
                      <b>
                        <RichText text={x.prompt} />
                      </b>
                      <small>
                        Answer: <RichText text={x.choices[x.answerIndex]} />
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
