'use client';

import type { ExtractedDocument } from '../learning/contracts.ts';
import type { FigureInput } from '../learning/figure-store.ts';
import { PdfFileError, readPdfFile } from '../pdf/browser.ts';
import { PdfExtractError } from '../pdf/extract.ts';
import { validatePdfMeta } from '../pdf/validate.ts';
import { extractPptxText, PptxExtractError } from '../pptx/extract.ts';
import { validatePptxBytes, validatePptxMeta } from '../pptx/validate.ts';

/**
 * One entry point for the file types a student can upload. Whatever the type,
 * the file is read on the device and only its extracted text is passed on.
 */

export type SourceFileKind = 'pdf' | 'pptx';

export interface SourceFile {
  doc: ExtractedDocument;
  /** Pictures found on the slides, to show next to lessons. Empty for PDFs. */
  figures: FigureInput[];
}

/** A message that is safe to show the student as it is. */
export class SourceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFileError';
  }
}

const isPresentation = (file: { name: string; type?: string }) =>
  /\.pptx?$/i.test(file.name) || (file.type ?? '').includes('presentation') || file.type === 'application/vnd.ms-powerpoint';

export const sourceKindOf = (file: { name: string; type?: string }): SourceFileKind => (isPresentation(file) ? 'pptx' : 'pdf');

/** Cheap checks on name, type and size. Returns a message for the student, or null when the file can be read. */
export function checkSourceFile(file: { name: string; size: number; type?: string }): string | null {
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf && !isPresentation(file)) return 'Choose a PDF (.pdf) or a PowerPoint presentation (.pptx).';
  const result = isPresentation(file) ? validatePptxMeta(file) : validatePdfMeta(file);
  return result.ok ? null : (result.message ?? 'That file cannot be used.');
}

export async function readSourceFile(
  file: File,
  onProgress?: (unit: number, total: number) => void,
): Promise<SourceFile> {
  try {
    if (!isPresentation(file)) return { doc: await readPdfFile(file, onProgress), figures: [] };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validatePptxBytes(bytes);
    if (!check.ok) throw new SourceFileError(check.message ?? 'That file is not a valid presentation.');
    const { media, ...doc } = await extractPptxText(bytes, file.name, onProgress);
    return { doc, figures: media };
  } catch (err) {
    if (err instanceof SourceFileError) throw err;
    if (err instanceof PdfExtractError || err instanceof PdfFileError || err instanceof PptxExtractError) {
      throw new SourceFileError(err.message);
    }
    throw new SourceFileError('This file could not be read. Try a different file.');
  }
}
