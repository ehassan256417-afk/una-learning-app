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
import { checkBackend, LESSON_API_URL, LessonApiError, requestLessons } from '@/lib/learning/api';
import type { ExtractedDocument, HealthResponse } from '@/lib/learning/contracts';
import { findGeneratedByDocument, saveGeneratedCourse } from '@/lib/learning/generated-store';
import { coursePath } from '@/lib/learning/links';
import type { Course } from '@/lib/learning/types';
import { PdfFileError, readPdfFile } from '@/lib/pdf/browser';
import { PdfExtractError } from '@/lib/pdf/extract';
import { formatBytes, validatePdfMeta } from '@/lib/pdf/validate';
import { useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';

const PIPELINE = [
  { icon: FileSearch, title: 'Read the PDF on your device', body: 'Text is extracted page by page in your browser. The file itself is never uploaded.' },
  { icon: BookOpenCheck, title: 'Build three levels', body: 'Beginner, Intermediate and Advanced lessons with notes, questions and flashcards.' },
  { icon: Quote, title: 'Cite every item', body: 'Each note and question carries the page number and the quote it is based on.' },
  { icon: ShieldCheck, title: 'Check against your PDF', body: 'Items whose quotes cannot be found in your PDF are removed. This lowers errors; it cannot rule them out.' },
];

type Backend = { state: 'checking' } | { state: 'off' } | { state: 'down' } | { state: 'up'; info: HealthResponse };

type Phase =
  | { step: 'idle' }
  | { step: 'reading'; page: number; total: number }
  | { step: 'ready' }
  | { step: 'generating' }
  | { step: 'done'; course: Course; reused: 'saved' | 'server' | null };

export function UploadView() {
  const { markPdfSelected } = useProgress();
  const input = useRef<HTMLInputElement>(null);
  const [backend, setBackend] = useState<Backend>({ state: LESSON_API_URL ? 'checking' : 'off' });
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [doc, setDoc] = useState<ExtractedDocument | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [error, setError] = useState('');
  const job = useRef(0);

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
    setFile(null);
    setDoc(null);
    setError('');
    setPhase({ step: 'idle' });
    if (input.current) input.current.value = '';
  };

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const id = ++job.current;
    setError('');
    setDoc(null);
    const meta = validatePdfMeta(picked);
    if (!meta.ok) {
      setFile(null);
      setPhase({ step: 'idle' });
      setError(meta.message ?? 'That file cannot be used.');
      return;
    }
    setFile({ name: picked.name, size: picked.size });
    setPhase({ step: 'reading', page: 0, total: 0 });
    try {
      const extracted = await readPdfFile(picked, (page, total) => {
        if (job.current === id) setPhase({ step: 'reading', page, total });
      });
      if (job.current !== id) return;
      setDoc(extracted);
      markPdfSelected();
      const saved = findGeneratedByDocument(extracted.id);
      setPhase(saved ? { step: 'done', course: saved, reused: 'saved' } : { step: 'ready' });
    } catch (err) {
      if (job.current !== id) return;
      setPhase({ step: 'idle' });
      setFile(null);
      setError(
        err instanceof PdfExtractError || err instanceof PdfFileError
          ? err.message
          : 'This PDF could not be read. Try a different file.',
      );
    }
  };

  const generate = async () => {
    if (!doc) return;
    const id = ++job.current;
    setError('');
    setPhase({ step: 'generating' });
    try {
      const { course, cached } = await requestLessons(doc);
      if (job.current !== id) return;
      if (!saveGeneratedCourse(course)) {
        setError('The lessons were created but this browser has no space to save them. Remove an older PDF course and try again.');
        setPhase({ step: 'ready' });
        return;
      }
      setPhase({ step: 'done', course, reused: cached ? 'server' : null });
    } catch (err) {
      if (job.current !== id) return;
      setPhase({ step: 'ready' });
      setError(err instanceof LessonApiError ? err.message : 'Something went wrong while creating the lessons.');
      if (err instanceof LessonApiError && err.code === 'network') setBackend({ state: 'down' });
    }
  };

  const busy = phase.step === 'reading' || phase.step === 'generating';
  const canGenerate = backend.state === 'up';
  const report = phase.step === 'done' ? phase.course.generation?.report : undefined;

  return (
    <main className="screen with-nav">
      <section className="hero hero-compact">
        <div className="hero-glow" aria-hidden="true" />
        <AppHeader />
        <div className="hero-title">
          <h1>Upload a Course PDF</h1>
          <p>Turn course material into lessons with three learning levels.</p>
        </div>
      </section>

      <div className="pad pad-top">
        {backend.state === 'off' && (
          <div className="note note-warn">
            <WifiOff size={20} />
            <span>
              <b>Lesson generation is not connected on this site yet.</b> You can still choose a PDF to check that its
              text can be read. Nothing is uploaded.
            </span>
          </div>
        )}
        {backend.state === 'down' && (
          <div className="note note-warn" role="status">
            <WifiOff size={20} />
            <span>
              <b>The lesson service is not reachable.</b> You can still read a PDF here; generating lessons will work
              once the service is running.
            </span>
          </div>
        )}
        {backend.state === 'up' && (
          <div className="note note-info" role="status">
            <ShieldCheck size={20} />
            <span>
              <b>Your PDF file stays on this device.</b> Only its extracted text is sent to the lesson service
              {backend.info.provider === 'mock'
                ? ', which is running in offline sample mode (no AI): lessons are built by copying sentences from your PDF.'
                : ' to build the lessons.'}
            </span>
          </div>
        )}

        {!file ? (
          <label className="drop">
            <span className="drop-ico">
              <FileUp size={30} />
            </span>
            <strong>Choose a PDF file</strong>
            <small>Text-based PDF • up to 25 MB and 60 pages</small>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="card filecard">
            <span className="pdfico pdfico-purple" aria-hidden="true">
              <FileText size={22} />
              <b>PDF</b>
            </span>
            <span className="filecard-body">
              <b>{file.name}</b>
              <small>
                {formatBytes(file.size)}
                {doc && ` • ${doc.pageCount} pages • ${doc.charCount.toLocaleString()} characters of text`}
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
              <b>Reading your PDF…</b>
              <small>{phase.total ? `Page ${phase.page} of ${phase.total}` : 'Opening the file'}</small>
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
                {doc.pages.length} of {doc.pageCount} pages
              </small>
            </div>
            <p className="excerpt">
              <span className="pagechip">Page {doc.pages[0].page}</span> {doc.pages[0].text.slice(0, 220)}
              {doc.pages[0].text.length > 220 && '…'}
            </p>
            {doc.truncated && <p className="muted">This PDF is long, so only the first part of its text will be used.</p>}
            <button type="button" className="btn btn-gold btn-xl gap-top" onClick={generate} disabled={!canGenerate}>
              <Sparkles size={20} /> Generate lessons
            </button>
            {!canGenerate && <p className="muted">Generating needs the lesson service, which is not available right now.</p>}
          </div>
        )}

        {phase.step === 'generating' && (
          <div className="card statuscard" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <b>Building your lessons…</b>
              <small>Writing three levels and checking each item against your PDF. This can take up to a minute.</small>
            </div>
          </div>
        )}

        {phase.step === 'done' && (
          <div className="card resultcard">
            <h2>
              <CheckCircle2 size={22} className="c-green" /> {phase.reused === 'saved' ? 'Lessons already saved' : 'Lessons ready'}
            </h2>
            <p>
              <b>{phase.course.title}</b> • {phase.course.sections.length} level
              {phase.course.sections.length === 1 ? '' : 's'}: {phase.course.sections.map((s) => s.difficulty).join(', ')}
            </p>
            {report && (
              <p className="muted">
                {report.kept} of {report.checked} generated items matched your PDF
                {report.dropped > 0 && `; ${report.dropped} were removed`}. This automated check reduces mistakes but
                does not guarantee accuracy.
              </p>
            )}
            {phase.reused && (
              <p className="muted">
                {phase.reused === 'saved'
                  ? 'These were generated earlier on this device, so no new AI request was made.'
                  : 'The lesson service reused an earlier result, so no new AI request was made.'}
              </p>
            )}
            <Link href={coursePath(phase.course)} className="btn btn-gold btn-xl gap-top">
              Open learning path <ArrowRight size={20} />
            </Link>
            {phase.reused === 'saved' && canGenerate && (
              <button type="button" className="textlink center" onClick={generate}>
                <RotateCcw size={16} /> Generate again
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
