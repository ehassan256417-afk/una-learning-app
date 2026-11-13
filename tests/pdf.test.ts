import { describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { LIMITS } from '../lib/learning/contracts.ts';
import { cleanPageText, extractPdfText, PdfExtractError } from '../lib/pdf/extract.ts';
import { validatePdfBytes, validatePdfMeta } from '../lib/pdf/validate.ts';
import { makePdf } from './helpers/make-pdf.ts';
import { extractSample, pdfjs, SAMPLE_KEYS, SAMPLES, samplePdfBytes } from './helpers/samples.ts';

describe('PDF file validation', () => {
  it('accepts a normal PDF', () => {
    expect(validatePdfMeta({ name: 'notes.pdf', size: 20_000, type: 'application/pdf' }).ok).toBe(true);
  });

  it('accepts a .PDF extension even when the browser gives no type', () => {
    expect(validatePdfMeta({ name: 'CHAPTER.PDF', size: 20_000, type: '' }).ok).toBe(true);
  });

  it('rejects other file types', () => {
    expect(validatePdfMeta({ name: 'essay.docx', size: 20_000, type: 'application/msword' })).toMatchObject({
      ok: false,
      code: 'not_pdf',
    });
  });

  it('rejects empty and oversized files', () => {
    expect(validatePdfMeta({ name: 'a.pdf', size: 0 })).toMatchObject({ ok: false, code: 'empty' });
    expect(validatePdfMeta({ name: 'a.pdf', size: LIMITS.maxFileBytes + 1 })).toMatchObject({
      ok: false,
      code: 'too_large',
    });
  });

  it('checks the file signature, not just the name', () => {
    expect(validatePdfBytes(new TextEncoder().encode('PK\u0003\u0004 this is really a zip'))).toMatchObject({
      ok: false,
      code: 'bad_signature',
    });
    expect(validatePdfBytes(samplePdfBytes('biology')).ok).toBe(true);
  });
});

describe('cleanPageText', () => {
  it('rejoins hyphenated line breaks and collapses whitespace', () => {
    expect(cleanPageText('photo-\nsynthesis  uses\nlight   energy')).toBe('photosynthesis uses light energy');
  });
});

describe('PDF text extraction with page references', () => {
  for (const key of SAMPLE_KEYS) {
    it(`extracts every page of the ${key} sample with the right page numbers`, async () => {
      const doc = await extractSample(key);
      const source = SAMPLES[key].pages;
      expect(doc.pageCount).toBe(source.length);
      expect(doc.pages.map((p) => p.page)).toEqual(source.map((_, i) => i + 1));
      doc.pages.forEach((p, i) => expect(p.text).toBe(source[i]));
      expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
    });
  }

  it('gives the same document id for the same text and a different id for different text', async () => {
    const [a, b, c] = await Promise.all([extractSample('history'), extractSample('history'), extractSample('biology')]);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  it('reports progress page by page', async () => {
    const seen: string[] = [];
    await extractPdfText(pdfjs, samplePdfBytes('computing'), 'x.pdf', (n, total) => seen.push(`${n}/${total}`));
    expect(seen).toEqual(['1/3', '2/3', '3/3']);
  });

  it('rejects a PDF with almost no text (e.g. a scan)', async () => {
    await expect(extractPdfText(pdfjs, makePdf(['Only a title.']), 'scan.pdf')).rejects.toMatchObject({
      name: 'PdfExtractError',
      code: 'no_text',
    });
  });

  it('rejects a damaged file', async () => {
    const broken = new TextEncoder().encode('%PDF-1.4\nthis is not really a pdf document');
    await expect(extractPdfText(pdfjs, broken, 'broken.pdf')).rejects.toBeInstanceOf(PdfExtractError);
  });

  it('rejects documents over the page limit', async () => {
    const many = makePdf(Array.from({ length: LIMITS.maxPages + 1 }, (_, i) => `Page ${i + 1} of a very long document.`));
    await expect(extractPdfText(pdfjs, many, 'long.pdf')).rejects.toMatchObject({ code: 'too_many_pages' });
  });
});
