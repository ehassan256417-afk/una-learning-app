'use client';

import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileSearch,
  FileText,
  FileUp,
  Quote,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { generateAdaptiveCourse, unfinishedLessons } from '@/lib/learning/adaptive';
import { checkBackend, LESSON_API_URL, LessonApiError, requestLesson, requestPlan } from '@/lib/learning/api';
import type { ExtractedDocument, HealthResponse } from '@/lib/learning/contracts';
import { summarizeCoverage } from '@/lib/learning/coverage';
import { saveFigures, type FigureInput } from '@/lib/learning/figure-store';
import { findGeneratedByDocument, saveGeneratedCourse } from '@/lib/learning/generated-store';
import { coursePath } from '@/lib/learning/links';
import type { Course } from '@/lib/learning/types';
import { formatBytes } from '@/lib/pdf/validate';
import { checkSourceFile, readSourceFile, SourceFileError, sourceKindOf, type SourceFileKind } from '@/lib/source/browser';
import { useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';

const PIPELINE = [
  { icon: FileSearch, title: 'Read the file on your device', body: 'Text is extracted page by page (or slide by slide) in your browser. The file itself is never uploaded.' },
  { icon: BookOpenCheck, title: 'Plan lessons from the concepts', body: 'The concepts in your file decide how many lessons there are and their order. Each lesson is Beginner, Intermediate or Advanced.' },
  { icon: Quote, title: 'Cite every item', body: 'Each note and question carries the page or slide number and the quote it is based on.' },
  { icon: ShieldCheck, title: 'Check against your file', body: 'Items whose quotes cannot be found in your file are removed. This lowers errors; it cannot rule them out.' },
];

type Backend = { state: 'checking' } | { state: 'off' } | { state: 'down' } | { state: 'up'; info: HealthResponse };

type Phase =
  | { step: 'idle' }
  | { step: 'reading'; page: number; total: number }
  | { step: 'ready' }
  | { step: 'generating'; title: string; detail: string }
  | { step: 'done'; course: Course; reused: 'saved' | null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function UploadView() {
  const { markPdfSelected } = useProgress();
  const input = useRef<HTMLInputElement>(null);
  const [backend, setBackend] = useState<Backend>({ state: LESSON_API_URL ? 'checking' : 'off' });
  const [file, setFile] = useState<{ name: string; size: number; kind: SourceFileKind } | null>(null);
  /** Pictures from the slides, saved on this device when lessons are generated. */
  const [figures, setFigures] = useState<FigureInput[]>([]);
  const [doc, setDoc] = useState<ExtractedDocument | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [error, setError] = useState('');
  const job = useRef(0);
  const stopper = useRef<AbortController | null>(null);

  // Stop any generation still running when the student leaves this page.
  useEffect(() => () => stopper.current?.abort(), []);

  useEffect(() => {
    if (!LESSON_API_URL) return;
    const controller = new AbortController();
    checkBackend(controller.signal).then((info) => {
      if (!controller.signal.aborted) setBackend(info ? { state: 'up', info } : { state: 'down' });
    });
    return () => controller.abort();
  }, []);

  const reset = () => {
    job.current++;
    stopper.current?.abort();
    setFile(null);
    setDoc(null);
    setFigures([]);
    setError('');
    setPhase({ step: 'idle' });
    if (input.current) input.current.value = '';
  };

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const id = ++job.current;
    setError('');
    setDoc(null);
    setFigures([]);
    const problem = checkSourceFile(picked);
    if (problem) {
      setFile(null);
      setPhase({ step: 'idle' });
      setError(problem);
      return;
    }
    setFile({ name: picked.name, size: picked.size, kind: sourceKindOf(picked) });
    setPhase({ step: 'reading', page: 0, total: 0 });
    try {
      const source = await readSourceFile(picked, (page, total) => {
        if (job.current === id) setPhase({ step: 'reading', page, total });
      });
      if (job.current !== id) return;
      const extracted = source.doc;
      setFigures(source.figures);
      setDoc(extracted);
      markPdfSelected();
      const saved = findGeneratedByDocument(extracted.id);
      setPhase(saved ? { step: 'done', course: saved, reused: 'saved' } : { step: 'ready' });
    } catch (err) {
      if (job.current !== id) return;
      setPhase({ step: 'idle' });
      setFile(null);
      setError(err instanceof SourceFileError ? err.message : 'This file could not be read. Try a different file.');
    }
  };

  /**
   * Plans the course, then generates one lesson per request. The course is
   * saved after every lesson, so whatever was generated survives a failure.
   * With `resume`, the saved plan is reused and only missing lessons are requested.
   */
  const generate = async (resume?: Course) => {
    if (!doc) return;
    const id = ++job.current;
    setError('');
    setPhase({
      step: 'generating',
      title: resume ? 'Continuing your course…' : 'Planning your lessons…',
      detail: resume ? 'Picking up where generation stopped.' : 'Finding the concepts in your PDF and how they build on each other.',
    });
    // Leaving the page or removing the file stops further requests.
    stopper.current?.abort();
    const controller = new AbortController();
    stopper.current = controller;
    // Lessons saved earlier for this PDF stay in place until a new lesson exists to replace them.
    const previous = findGeneratedByDocument(doc.id);
    // Slide pictures stay in this browser; lessons show them beside the notes that cite the slide.
    if (figures.length > 0) void saveFigures(doc.id, figures);
    try {
      const result = await generateAdaptiveCourse({
        doc,
        api: { plan: requestPlan, lesson: requestLesson },
        resume,
        save: saveGeneratedCourse,
        deferFirstSave: !!previous && previous.sections.length > 0,
        signal: controller.signal,
        onProgress: (p) => {
          if (job.current !== id || p.stage !== 'lesson') return;
          setPhase({ step: 'generating', title: `Writing lesson ${p.index + 1} of ${p.total}`, detail: p.title });
        },
      });
      if (job.current !== id) return;
      if (result.stopped) {
        setError(result.stopped.message);
        if (result.stopped.code === 'network') setBackend({ state: 'down' });
      }
      // Show what is actually saved: if nothing new was generated, that is still the earlier course.
      const saved = findGeneratedByDocument(doc.id);
      const shown = result.course.sections.length === 0 && saved && saved.sections.length > 0 ? saved : result.course;
      setPhase({ step: 'done', course: shown, reused: shown === saved && shown !== result.course ? 'saved' : null });
    } catch (err) {
      if (job.current !== id) return;
      setError(err instanceof LessonApiError ? err.message : 'Something went wrong while creating the lessons.');
      if (err instanceof LessonApiError && err.code === 'network') setBackend({ state: 'down' });
      // Anything already saved for this PDF is still there; show it instead of starting over.
      const saved = findGeneratedByDocument(doc.id);
      setPhase(saved ? { step: 'done', course: saved, reused: 'saved' } : { step: 'ready' });
    }
  };

  const busy = phase.step === 'reading' || phase.step === 'generating';
  const unit = file?.kind === 'pptx' ? 'slide' : 'page';
  const Unit = file?.kind === 'pptx' ? 'Slide' : 'Page';
  const canGenerate = backend.state === 'up';
  const done = phase.step === 'done' ? phase.course : undefined;
  const report = done?.generation?.report;
  const planned = done?.plan?.lessons.length ?? 0;
  const remaining = done ? unfinishedLessons(done) : 0;
  const coverage = done?.coverage ? summarizeCoverage(done.coverage) : undefined;
  const levels = done
    ? (['Beginner', 'Intermediate', 'Advanced'] as const)
        .map((level) => ({ level, n: done.sections.filter((s) => s.difficulty === level).length }))
        .filter((x) => x.n > 0)
        .map((x) => `${x.n} ${x.level}`)
        .join(', ')
    : '';

  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="hero-title">
          <h1>Upload Course Material</h1>
          <p>Turn a PDF or a PowerPoint into lessons with three learning levels.</p>
        </div>
      </section>

      <div className="pad pad-top">
        {backend.state === 'off' && (
          <div className="note note-warn">
            <WifiOff size={20} />
            <span>
              <b>Lesson generation is not connected on this site yet.</b> You can still choose a file to check that its
              text can be read. Nothing is uploaded.
            </span>
          </div>
        )}
        {backend.state === 'down' && (
          <div className="note note-warn" role="status">
            <WifiOff size={20} />
            <span>
              <b>The lesson service is not reachable.</b> You can still read a file here; generating lessons will work
              once the service is running.
            </span>
          </div>
        )}
        {backend.state === 'up' && (
          <div className="note note-info" role="status">
            <ShieldCheck size={20} />
            <span>
              <b>Your file stays on this device.</b> Only its extracted text is sent to the lesson service
              {backend.info.provider === 'mock'
                ? ', which is running in offline sample mode (no AI): lessons are built by copying sentences from your file.'
                : ' to build the lessons.'}
            </span>
          </div>
        )}

        {!file ? (
          <label className="drop">
            <span className="drop-ico">
              <FileUp size={30} />
            </span>
            <strong>Choose a PDF or PowerPoint</strong>
            <small>.pdf or .pptx with real text • up to 25 MB and 60 pages or slides</small>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="sr-only"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="card filecard">
            <span className="pdfico pdfico-purple" aria-hidden="true">
              <FileText size={22} />
              <b>{file.kind === 'pptx' ? 'PPT' : 'PDF'}</b>
            </span>
            <span className="filecard-body">
              <b>{file.name}</b>
              <small>
                {formatBytes(file.size)}
                {doc && ` • ${doc.pageCount} ${unit}s • ${doc.charCount.toLocaleString()} characters of text`}
              </small>
            </span>
            <button type="button" className="iconbtn subtle" onClick={reset} aria-label="Remove file" disabled={phase.step === 'generating'}>
              <Trash2 size={20} />
            </button>
          </div>
        )}

        {error && (
          <div className="note note-error" role="alert">
            <AlertTriangle size={20} />
            <span>{error}</span>
          </div>
        )}

        {phase.step === 'reading' && (
          <div className="card statuscard" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <b>Reading your file…</b>
              <small>{phase.total ? `${Unit} ${phase.page} of ${phase.total}` : 'Opening the file'}</small>
            </div>
          </div>
        )}

        {phase.step === 'ready' && doc && (
          <div className="card">
            <div className="cardhead">
              <h2>
                <CheckCircle2 size={20} className="c-green" /> Text found
              </h2>
              <small>
                {doc.pages.length} of {doc.pageCount} {unit}s
              </small>
            </div>
            <p className="excerpt">
              <span className="pagechip">{Unit} {doc.pages[0].page}</span> {doc.pages[0].text.slice(0, 220)}
              {doc.pages[0].text.length > 220 && '…'}
            </p>
            {doc.truncated && <p className="muted">This file is long, so only the first part of its text will be used.</p>}
            {figures.length > 0 && (
              <p className="muted">
                {plural(figures.length, 'picture')} found on the slides. They stay on this device and are shown beside
                the lessons that cite their slide. Lessons are written from the slide text only.
              </p>
            )}
            <button type="button" className="btn btn-gold btn-xl gap-top" onClick={() => void generate()} disabled={!canGenerate}>
              <Sparkles size={20} /> Generate lessons
            </button>
            <p className="muted">
              One request plans the lessons from the concepts in your file, then each lesson is written with its own
              request. Longer files take more requests and more time.
            </p>
            {!canGenerate && <p className="muted">Generating needs the lesson service, which is not available right now.</p>}
          </div>
        )}

        {phase.step === 'generating' && (
          <div className="card statuscard" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <b>{phase.title}</b>
              <small>
                {phase.detail} Each lesson is checked against your file and saved as soon as it is ready. Keep this
                page open.
              </small>
            </div>
          </div>
        )}

        {phase.step === 'done' && done && (
          <div className="card resultcard">
            <h2>
              <CheckCircle2 size={22} className="c-green" />{' '}
              {phase.reused === 'saved'
                ? 'Lessons already saved'
                : remaining > 0
                  ? `${done.sections.length} of ${planned} lessons ready`
                  : 'Lessons ready'}
            </h2>
            <p>
              <b>{done.title}</b> • {plural(done.sections.length, 'lesson')}
              {levels && `: ${levels}`}
            </p>
            {coverage && (
              <p className="muted">
                {coverage.covered} of {plural(coverage.concepts, 'concept')} from the plan {coverage.covered === 1 ? 'has' : 'have'}{' '}
                both an explanation and a practice question. {coverage.pagesTaught} of{' '}
                {plural(coverage.pagesWithText, unit)} with text {coverage.pagesTaught === 1 ? 'is' : 'are'} cited
                {coverage.pagesOmitted.length > 0 && `; no lesson uses ${unit}${coverage.pagesOmitted.length === 1 ? '' : 's'} ${coverage.pagesOmitted.join(', ')}`}
                . The learning path lists anything that was left out.
              </p>
            )}
            {report && report.checked > 0 && (
              <p className="muted">
                {report.kept} of {report.checked} generated items matched your file
                {report.dropped > 0 && `; ${report.dropped} were removed`}. This automated check reduces mistakes but
                does not guarantee accuracy.
              </p>
            )}
            {done.budget && (
              <p className="muted">
                AI requests used for this course: {done.budget.requests} of {done.budget.maxRequests}.
              </p>
            )}
            {phase.reused === 'saved' && (
              <p className="muted">These were generated earlier on this device, so no new AI request was made.</p>
            )}
            {done.sections.length > 0 && (
              <Link href={coursePath(done)} className="btn btn-gold btn-xl gap-top">
                Open learning path <ArrowRight size={20} />
              </Link>
            )}
            {remaining > 0 && canGenerate && (
              <>
                <button type="button" className="btn btn-outline btn-xl gap-top" onClick={() => void generate(done)}>
                  <Sparkles size={20} /> Generate the remaining {plural(remaining, 'lesson')}
                </button>
                <p className="muted">
                  This makes up to {plural(remaining, 'new AI request')}. Lessons that are already saved are not
                  generated again.
                </p>
              </>
            )}
            {remaining === 0 && phase.reused === 'saved' && canGenerate && (
              <button type="button" className="textlink center" onClick={() => void generate()}>
                <RotateCcw size={16} /> Plan and generate again (new AI requests)
              </button>
            )}
          </div>
        )}

        <div className="card">
          <div className="cardhead">
            <h2>How lessons are built</h2>
          </div>
          <ol className="pipeline">
            {PIPELINE.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <span className="pipeline-ico">
                  <Icon size={18} />
                </span>
                <span>
                  <b>{title}</b>
                  <small>{body}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {!busy && phase.step !== 'done' && (
          <Link href="/courses/cis-344" className="textlink center">
            Or explore a demo learning path <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </main>
  );
}
