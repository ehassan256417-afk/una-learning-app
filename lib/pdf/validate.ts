import { LIMITS } from '../learning/contracts.ts';

export type PdfValidationCode = 'not_pdf' | 'too_large' | 'empty' | 'bad_signature';

export interface PdfValidationResult {
  ok: boolean;
  code?: PdfValidationCode;
  message?: string;
}

const fail = (code: PdfValidationCode, message: string): PdfValidationResult => ({ ok: false, code, message });

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Cheap checks that need only the file's metadata. */
export function validatePdfMeta(file: { name: string; size: number; type?: string }): PdfValidationResult {
  const looksPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksPdf) return fail('not_pdf', 'That file is not a PDF. Choose a file ending in .pdf.');
  if (file.size === 0) return fail('empty', 'That file is empty.');
  if (file.size > LIMITS.maxFileBytes) {
    return fail('too_large', `That PDF is ${formatBytes(file.size)}. The limit is ${formatBytes(LIMITS.maxFileBytes)}.`);
  }
  return { ok: true };
}

/** A real PDF starts with "%PDF-" (allowing a few leading bytes, as readers do). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export function validatePdfBytes(bytes: Uint8Array): PdfValidationResult {
  if (bytes.byteLength === 0) return fail('empty', 'That file is empty.');
  if (!hasPdfSignature(bytes)) {
    return fail('bad_signature', 'That file has a .pdf name but is not a valid PDF document.');
  }
  return { ok: true };
}
