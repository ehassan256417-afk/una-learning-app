'use client';

import type { ExtractedDocument } from '../learning/contracts.ts';
import { extractPdfText, type PdfLib } from './extract.ts';
import { validatePdfBytes } from './validate.ts';

/**
 * Browser-side PDF reading. pdf.js is loaded on demand (it is large) and runs
 * in a web worker served from this site, so the PDF never leaves the device.
 */

let loading: Promise<PdfLib> | null = null;

function loadPdfJs(): Promise<PdfLib> {
  loading ??= import('pdfjs-dist').then((mod) => {
    // The worker file is copied into /public by scripts/copy-pdf-worker.mjs.
    mod.GlobalWorkerOptions.workerSrc = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/pdf.worker.min.mjs`;
    return mod as unknown as PdfLib;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export class PdfFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfFileError';
  }
}

export async function readPdfFile(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validatePdfBytes(bytes);
  if (!check.ok) throw new PdfFileError(check.message ?? 'That file is not a valid PDF.');
  const pdfjs = await loadPdfJs().catch(() => {
    throw new PdfFileError('The PDF reader could not be loaded. Check your connection and try again.');
  });
  return extractPdfText(pdfjs, bytes, file.name, onProgress);
}
