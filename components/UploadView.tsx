'use client';

import { ArrowRight, BookOpenCheck, FileSearch, FileText, FileUp, Quote, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { getLearningEngine } from '@/lib/learning/engine';
import { useProgress } from '@/lib/progress/store';
import { AppHeader } from './AppHeader';

const MAX_BYTES = 25 * 1024 * 1024;

const PIPELINE = [
  { icon: FileSearch, title: 'Read the PDF', body: 'Extract the text page by page and keep the page numbers.' },
  { icon: BookOpenCheck, title: 'Build lessons', body: 'Create notes, quizzes and flashcards from the extracted text only.' },
  { icon: Quote, title: 'Cite every claim', body: 'Attach the page and excerpt that supports each note and question.' },
  { icon: ShieldCheck, title: 'Reject unsupported content', body: 'Anything without a supporting excerpt is left out.' },
];

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function UploadView() {
  const { markPdfSelected } = useProgress();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const choose = async (f: File | undefined) => {
    setError('');
    setNotice('');
    if (!f) return;
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setFile(null);
      setError('That file is not a PDF. Choose a file ending in .pdf.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      setError(`That PDF is ${formatSize(f.size)}. The limit is 25 MB.`);
      return;
    }
    const picked = { name: f.name, size: f.size };
    setFile(picked);
    markPdfSelected();
    // The demo engine never reads the file; it only reports that ingestion is unavailable.
    const result = await getLearningEngine().ingestPdf(picked);
    if (result.status === 'unavailable') setNotice(result.message);
  };

  const clear = () => {
    setFile(null);
    setNotice('');
    setError('');
    if (input.current) input.current.value = '';
  };

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
        <div className="note note-warn">
          <ShieldCheck size={20} />
          <span>
            <b>Preview only.</b> PDF processing is not built yet. A file you choose stays on this device and is not
            uploaded or analyzed.
          </span>
        </div>

        {!file ? (
          <label className="drop">
            <span className="drop-ico">
              <FileUp size={30} />
            </span>
            <strong>Choose a PDF file</strong>
            <small>PDF only • up to 25 MB</small>
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
              <small>{formatSize(file.size)} • selected, not uploaded</small>
            </span>
            <button type="button" className="iconbtn subtle" onClick={clear} aria-label="Remove file">
              <Trash2 size={20} />
            </button>
          </div>
        )}
        {error && (
          <p className="formerror" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="formnotice" role="status">
            {notice}
          </p>
        )}

        <div className="card">
          <div className="cardhead">
            <h2>How lessons will be built</h2>
            <span className="pill pill-soft">Planned</span>
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

        <Link href="/courses/cis-344" className="btn btn-gold btn-xl">
          View a demo learning path <ArrowRight size={20} />
        </Link>
      </div>
    </main>
  );
}
