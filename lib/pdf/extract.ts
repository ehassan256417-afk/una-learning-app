import { LIMITS, type ExtractedDocument, type ExtractedPage } from '../learning/contracts.ts';

/**
 * PDF text extraction with page references.
 *
 * The PDF library is injected so the same code runs in the browser (worker
 * build) and in Node tests (legacy build). Extraction happens on the student's
 * device: the PDF file itself is never sent anywhere, only the extracted text.
 */

/** The small part of pdf.js this module needs. */
export interface PdfLib {
  getDocument(src: { data: Uint8Array; verbosity?: number }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
      }>;
    }>;
    /** Releases the document's memory (pdf.js exposes this on the loading task). */
    destroy?(): Promise<void>;
  };
}

export type ExtractErrorCode = 'unreadable' | 'encrypted' | 'too_many_pages' | 'no_text';

export class PdfExtractError extends Error {
  code: ExtractErrorCode;

  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PdfExtractError';
  }
}

/** Joins hyphenated line breaks and collapses whitespace, keeping paragraphs readable. */
export function cleanPageText(raw: string): string {
  return raw
    .replace(/­/g, '')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable id for a document's extracted text; the same text always gives the same id. */
export const documentIdFor = (pages: ExtractedPage[]) =>
  sha256Hex(pages.map((p) => `${p.page}\u0000${p.text}`).join('\u0001'));

export async function extractPdfText(
  pdfjs: PdfLib,
  data: Uint8Array,
  name: string,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedDocument> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({ data: data.slice(), verbosity: 0 });
  let doc: Awaited<ReturnType<PdfLib['getDocument']>['promise']>;
  try {
    doc = await task.promise;
  } catch (err) {
    const label = err instanceof Error ? err.name : '';
    if (label === 'PasswordException') {
      throw new PdfExtractError('encrypted', 'This PDF is password-protected. Remove the password and try again.');
    }
    throw new PdfExtractError('unreadable', 'This PDF could not be read. It may be damaged.');
  }

  try {
    if (doc.numPages > LIMITS.maxPages) {
      throw new PdfExtractError(
        'too_many_pages',
        `This PDF has ${doc.numPages} pages. The limit is ${LIMITS.maxPages}; try uploading one chapter.`,
      );
    }
    const pages: ExtractedPage[] = [];
    let charCount = 0;
    let truncated = false;
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.(n, doc.numPages);
      const content = await (await doc.getPage(n)).getTextContent();
      const raw = content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('');
      let text = cleanPageText(raw);
      if (!text) continue; // blank or image-only page
      if (charCount + text.length > LIMITS.maxChars) {
        text = text.slice(0, Math.max(0, LIMITS.maxChars - charCount));
        truncated = true;
      }
      if (text) pages.push({ page: n, text });
      charCount += text.length;
      if (truncated) break;
    }
    if (charCount < LIMITS.minChars) {
      throw new PdfExtractError(
        'no_text',
        'No readable text was found. Scanned or image-only PDFs are not supported yet.',
      );
    }
    return { id: await documentIdFor(pages), name, pageCount: doc.numPages, pages, charCount, truncated };
  } finally {
    await task.destroy?.().catch(() => undefined);
  }
}
