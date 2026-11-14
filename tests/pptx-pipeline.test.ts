import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { generateAdaptiveCourse, type AdaptiveApi } from '../lib/learning/adaptive.ts';
import type { Course } from '../lib/learning/types.ts';
import { extractPptxText } from '../lib/pptx/extract.ts';
import { createApp } from '../server/app.ts';
import { MockProvider } from '../server/providers/mock.ts';
import { expect } from './helpers/expect.ts';
import { makePptx, TINY_PNG } from './helpers/make-pptx.ts';
import { SAMPLES } from './helpers/samples.ts';

/**
 * A presentation goes through the same plan, lesson and grounding pipeline as
 * a PDF. Slide N is sent as page N, so every citation must point at a slide.
 */
describe('slides through the lesson pipeline', () => {
  const ORIGIN = 'http://localhost:3000';
  let server: Server | undefined;
  after(() => server?.close());

  it('builds a grounded course from a .pptx, citing slide numbers', async () => {
    server = createServer(createApp({ provider: new MockProvider(), allowedOrigins: [ORIGIN], log: () => undefined }));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    };
    const api: AdaptiveApi = {
      plan: (doc) => post('/api/lessons/plan', { document: { name: doc.name, pageCount: doc.pageCount, pages: doc.pages } }),
      lesson: (body) => post('/api/lessons/lesson', body),
    };

    // A title slide with no body text, then one slide per sample page; slide 3 carries a picture.
    const bytes = makePptx(
      [
        { title: 'Photosynthesis' },
        ...SAMPLES.biology.pages.map((text, i) => ({ body: [text], ...(i === 1 ? { pictures: ['image1.png'] } : {}) })),
      ],
      { media: { 'image1.png': TINY_PNG } },
    );
    const { media, ...doc } = await extractPptxText(bytes, 'photosynthesis.pptx');
    expect(doc.sourceKind).toBe('pptx');
    expect(doc.pageCount).toBe(SAMPLES.biology.pages.length + 1);
    expect(media.map((m) => m.page)).toEqual([3]);

    let saved: Course | undefined;
    const result = await generateAdaptiveCourse({
      doc,
      api,
      save: (course) => {
        saved = course;
        return true;
      },
    });

    expect(result.stopped).toBe(undefined);
    expect(result.failed).toBe(0);
    expect(saved?.sourceKind).toBe('pptx');
    expect(saved?.unitLabel).toBe('Your slides');
    expect((saved?.sections.length ?? 0) > 0).toBe(true);

    const slides = new Set(doc.pages.map((p) => p.page));
    const cited = (saved?.sections ?? []).flatMap((s) =>
      [...s.notes, ...s.questions, ...s.flashcards].flatMap((item) =>
        item.provenance.kind === 'pdf' ? item.provenance.citations.map((c) => c.page) : [],
      ),
    );
    expect(cited.length > 0).toBe(true);
    expect(cited.every((page) => slides.has(page))).toBe(true);
  });
});
