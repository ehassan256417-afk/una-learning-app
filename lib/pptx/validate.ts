import { LIMITS } from '../learning/contracts.ts';
import { formatBytes } from '../pdf/validate.ts';

export type PptxValidationCode = 'not_pptx' | 'legacy_ppt' | 'too_large' | 'empty' | 'bad_signature';

export interface PptxValidationResult {
  ok: boolean;
  code?: PptxValidationCode;
  message?: string;
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const fail = (code: PptxValidationCode, message: string): PptxValidationResult => ({ ok: false, code, message });

/** Cheap checks that need only the file's metadata. */
export function validatePptxMeta(file: { name: string; size: number; type?: string }): PptxValidationResult {
  const name = file.name.toLowerCase();
  // The old binary format has its own message: students often have one and can convert it in a minute.
  if (name.endsWith('.ppt')) {
    return fail('legacy_ppt', 'Old .ppt files are not supported. Open it in PowerPoint and save it as .pptx, then try again.');
  }
  if (file.type !== PPTX_MIME && !name.endsWith('.pptx')) {
    return fail('not_pptx', 'That file is not a PowerPoint presentation. Choose a file ending in .pptx.');
  }
  if (file.size === 0) return fail('empty', 'That file is empty.');
  if (file.size > LIMITS.maxFileBytes) {
    return fail('too_large', `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(LIMITS.maxFileBytes)}.`);
  }
  return { ok: true };
}

/** A .pptx is a zip archive, so it starts with "PK\x03\x04". */
export function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function validatePptxBytes(bytes: Uint8Array): PptxValidationResult {
  if (bytes.byteLength === 0) return fail('empty', 'That file is empty.');
  if (!hasZipSignature(bytes)) {
    return fail(
      'bad_signature',
      'That file has a .pptx name but is not a valid presentation. If it is password-protected, remove the password first.',
    );
  }
  return { ok: true };
}
