import { describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { LIMITS } from '../lib/learning/contracts.ts';
import { decodeXmlEntities, extractPptxText, PptxExtractError, resolveTarget, textLines } from '../lib/pptx/extract.ts';
import { validatePptxBytes, validatePptxMeta } from '../lib/pptx/validate.ts';
import {
  declareSize,
  filler,
  makePptx,
  rel,
  TINY_GIF,
  TINY_JPEG,
  TINY_PNG,
  TINY_WEBP,
  zipFiles,
} from './helpers/make-pptx.ts';

const extract = (bytes: Uint8Array, name = 'lecture.pptx') => extractPptxText(bytes, name);

describe('PowerPoint file validation', () => {
  it('accepts a normal .pptx', () => {
    expect(validatePptxMeta({ name: 'week1.pptx', size: 50_000 }).ok).toBe(true);
  });

  it('accepts the PowerPoint MIME type even without the extension', () => {
    const type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    expect(validatePptxMeta({ name: 'download', size: 50_000, type }).ok).toBe(true);
  });

  it('gives a legacy .ppt file its own message about saving as .pptx', () => {
    const r = validatePptxMeta({ name: 'OLD.PPT', size: 50_000, type: 'application/vnd.ms-powerpoint' });
    expect(r).toMatchObject({ ok: false, code: 'legacy_ppt' });
    expect(r.message).toContain('.pptx');
  });

  it('rejects other file types', () => {
    expect(validatePptxMeta({ name: 'notes.pdf', size: 1000, type: 'application/pdf' })).toMatchObject({
      ok: false,
      code: 'not_pptx',
    });
  });

  it('rejects empty and oversized files', () => {
    expect(validatePptxMeta({ name: 'a.pptx', size: 0 })).toMatchObject({ ok: false, code: 'empty' });
    expect(validatePptxMeta({ name: 'a.pptx', size: LIMITS.maxFileBytes + 1 })).toMatchObject({
      ok: false,
      code: 'too_large',
    });
  });

  it('checks the zip signature, not just the name', () => {
    expect(validatePptxBytes(new TextEncoder().encode('%PDF-1.4 really a pdf'))).toMatchObject({
      ok: false,
      code: 'bad_signature',
    });
    expect(validatePptxBytes(new Uint8Array())).toMatchObject({ ok: false, code: 'empty' });
    expect(validatePptxBytes(makePptx([{ title: 'Hi' }])).ok).toBe(true);
  });
});

describe('XML helpers', () => {
  it('decodes named and numeric entities in a single pass', () => {
    expect(decodeXmlEntities('Tom &amp; Jerry &lt;b&gt; &quot;hi&quot; it&apos;s')).toBe('Tom & Jerry <b> "hi" it\'s');
    expect(decodeXmlEntities('&#65;&#x42;&#x1F600;')).toBe('AB\u{1F600}');
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeXmlEntities('bad &#0; &#xD800; &#99999999; end')).toBe('bad    end');
  });

  it('resolves relationship targets and refuses to leave the archive', () => {
    expect(resolveTarget('ppt/slides/', '../media/image1.png')).toBe('ppt/media/image1.png');
    expect(resolveTarget('ppt/slides/', '/ppt/media/image2.png')).toBe('ppt/media/image2.png');
    expect(resolveTarget('ppt/', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolveTarget('ppt/slides/', '../../../etc/passwd')).toBeNull();
    expect(resolveTarget('ppt/slides/', '..\\media\\x.png')).toBeNull();
  });

  it('turns a table into one readable line', () => {
    const xml =
      '<a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Name</a:t></a:r></a:p></a:txBody></a:tc>' +
      '<a:tc><a:txBody><a:p><a:r><a:t>Role</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
      '<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Ada</a:t></a:r></a:p></a:txBody></a:tc>' +
      '<a:tc><a:txBody><a:p/></a:txBody></a:tc></a:tr></a:tbl>';
    expect(textLines(xml)).toEqual(['Name | Role; Ada']);
  });
});

describe('PowerPoint text extraction with slide references', () => {
  it('reads slides in the order presentation.xml lists them, not by file number', async () => {
    const bytes = makePptx(
      [{ title: 'Alpha', body: [filler('first')] }, { title: 'Beta', body: [filler('second')] }, { title: 'Gamma' }],
      { order: [3, 1, 2] },
    );
    const doc = await extract(bytes);
    expect(doc.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(doc.pages[0].text).toBe('Gamma');
    expect(doc.pages[1].text.startsWith('Alpha first:')).toBe(true);
    expect(doc.pages[2].text.startsWith('Beta second:')).toBe(true);
  });

  it('falls back to slide file numbers when presentation.xml has no usable slide list', async () => {
    const bytes = makePptx([{ title: 'One', body: [filler('a')] }, { title: 'Two' }], {
      files: { 'ppt/_rels/presentation.xml.rels': null },
    });
    const doc = await extract(bytes);
    expect(doc.pageCount).toBe(2);
    expect(doc.pages.map((p) => p.text.split(' ')[0])).toEqual(['One', 'Two']);
  });

  it('extracts title and body paragraphs, turning line breaks into spaces', async () => {
    const doc = await extract(makePptx([{ title: 'Cell biology', body: ['Mitochondria\nmake ATP', filler('end')] }]));
    expect(doc.pages[0].text.startsWith('Cell biology Mitochondria make ATP end:')).toBe(true);
    expect(doc.sourceKind).toBe('pptx');
    expect(doc.media).toEqual([]);
  });

  it('reads tables as plain text', async () => {
    const doc = await extract(
      makePptx([{ title: 'Costs', table: [['Item', 'Price'], ['Pen', '2'], ['Book', '15']], body: [filler('x')] }]),
    );
    expect(doc.pages[0].text).toContain('Item | Price; Pen | 2; Book | 15');
  });

  it('reads text inside grouped shapes', async () => {
    const doc = await extract(makePptx([{ title: 'Diagram', group: ['Input', 'Output'], body: [filler('x')] }]));
    expect(doc.pages[0].text).toContain('Input Output');
  });

  it('appends speaker notes with a prefix and leaves out the slide number placeholder', async () => {
    const doc = await extract(makePptx([{ title: 'Intro', body: [filler('b')], notes: 'Mention the exam date' }]));
    const text = doc.pages[0].text;
    expect(text.endsWith('Speaker notes: Mention the exam date')).toBe(true);
    expect(text).not.toContain('Slide Number');
    expect(text.split(' ').includes('3')).toBe(false);
  });

  it('leaves the slide number on the slide out of the text', async () => {
    const doc = await extract(makePptx([{ title: 'Intro', body: [filler('b')] }]));
    expect(doc.pages[0].text.split(' ').includes('7')).toBe(false);
  });

  it('decodes entity-encoded text', async () => {
    const raw =
      '<p:sp><p:txBody><a:p><a:r><a:t>R&amp;D &lt;draft&gt; &quot;q&quot; &#169; &#x1F600; &amp;lt;</a:t></a:r></a:p></p:txBody></p:sp>';
    const doc = await extract(makePptx([{ body: [filler('b')], rawShapes: raw }]));
    expect(doc.pages[0].text).toContain('R&D <draft> "q" © \u{1F600} &lt;');
  });

  it('uses only the Choice side of alternate content, not its Fallback copy', async () => {
    const raw =
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
      '<mc:Choice Requires="x"><p:sp><p:txBody><a:p><a:r><a:t>Equation one</a:t></a:r></a:p></p:txBody></p:sp></mc:Choice>' +
      '<mc:Fallback><p:sp><p:txBody><a:p><a:r><a:t>Equation fallback</a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback>' +
      '</mc:AlternateContent>';
    const doc = await extract(makePptx([{ body: [filler('b')], rawShapes: raw }]));
    expect(doc.pages[0].text).toContain('Equation one');
    expect(doc.pages[0].text).not.toContain('fallback');
  });

  it('skips a slide with no text but still counts it', async () => {
    const doc = await extract(makePptx([{ body: [filler('a')] }, {}, { body: [filler('c')] }]));
    expect(doc.pageCount).toBe(3);
    expect(doc.pages.map((p) => p.page)).toEqual([1, 3]);
  });

  it('keeps hidden slides', async () => {
    const slide2 = '<p:sld xmlns:a="a" xmlns:p="p" show="0"><a:p><a:r><a:t>Hidden slide text</a:t></a:r></a:p></p:sld>';
    const bytes = makePptx([{ body: [filler('a')] }, {}], { files: { 'ppt/slides/slide2.xml': slide2 } });
    const doc = await extract(bytes);
    expect(doc.pages.map((p) => p.text)).toContain('Hidden slide text');
  });

  it('reports progress for every slide', async () => {
    const seen: Array<[number, number]> = [];
    const bytes = makePptx([{ body: [filler('a')] }, { body: [filler('b')] }]);
    await extractPptxText(bytes, 'x.pptx', (n, total) => seen.push([n, total]));
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('gives the same id for the same content and a different id for different content', async () => {
    const a = await extract(makePptx([{ body: [filler('same')] }]));
    const b = await extract(makePptx([{ body: [filler('same')] }]));
    const c = await extract(makePptx([{ body: [filler('other')] }]));
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.id).toBe(b.id);
    expect(a.id === c.id).toBe(false);
  });

  it('truncates at the character limit and flags it', async () => {
    const long = Array.from({ length: 50 }, (_, i) => `w${i}`.repeat(6)).join(' ');
    const slides = Array.from({ length: LIMITS.maxPages }, () => ({ body: [long.repeat(12)] }));
    const doc = await extract(makePptx(slides));
    expect(doc.truncated).toBe(true);
    expect(doc.charCount).toBe(LIMITS.maxChars);
    expect(doc.pages.reduce((n, p) => n + p.text.length, 0)).toBe(LIMITS.maxChars);
    expect(doc.pageCount).toBe(LIMITS.maxPages);
  });
});

describe('PowerPoint pictures', () => {
  it('returns each picture for its own slide with the right type and bytes', async () => {
    const bytes = makePptx(
      [
        { body: [filler('a')], pictures: ['image1.png'] },
        { body: [filler('b')] },
        { body: [filler('c')], pictures: ['photo.jpeg', 'anim.gif', 'pic.webp'] },
      ],
      { media: { 'image1.png': TINY_PNG, 'photo.jpeg': TINY_JPEG, 'anim.gif': TINY_GIF, 'pic.webp': TINY_WEBP } },
    );
    const { media } = await extract(bytes);
    expect(media.map((m) => [m.page, m.name, m.mime])).toEqual([
      [1, 'image1.png', 'image/png'],
      [3, 'photo.jpeg', 'image/jpeg'],
      [3, 'anim.gif', 'image/gif'],
      [3, 'pic.webp', 'image/webp'],
    ]);
    expect(Array.from(media[0].bytes)).toEqual(Array.from(TINY_PNG));
  });

  it('ignores media no slide shows, such as layout or master decoration', async () => {
    const bytes = makePptx([{ body: [filler('a')] }], {
      media: { 'unused.png': TINY_PNG },
      files: { 'ppt/slideLayouts/_rels/slideLayout1.xml.rels': '<Relationships/>' },
    });
    expect((await extract(bytes)).media).toEqual([]);
  });

  it('ignores a file whose extension does not match its content', async () => {
    const bytes = makePptx([{ body: [filler('a')], pictures: ['fake.png', 'swapped.jpg', 'real.png'] }], {
      media: { 'fake.png': new TextEncoder().encode('not an image at all'), 'swapped.jpg': TINY_PNG, 'real.png': TINY_PNG },
    });
    expect((await extract(bytes)).media.map((m) => m.name)).toEqual(['real.png']);
  });

  it('ignores unsupported picture formats', async () => {
    const bytes = makePptx([{ body: [filler('a')], pictures: ['chart.emf', 'icon.svg'] }], {
      media: { 'chart.emf': new Uint8Array(20), 'icon.svg': new TextEncoder().encode('<svg/>') },
    });
    expect((await extract(bytes)).media).toEqual([]);
  });

  it('skips a picture over 3 MB without failing', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1);
    big.set(TINY_PNG);
    const bytes = makePptx([{ body: [filler('a')], pictures: ['big.png', 'small.png'] }], {
      media: { 'big.png': big, 'small.png': TINY_PNG },
    });
    expect((await extract(bytes)).media.map((m) => m.name)).toEqual(['small.png']);
  });

  it('ignores external targets, paths that escape the archive and non-media paths', async () => {
    // Slide and rels are written by hand so every extra picture points somewhere it must not.
    const rels = [
      rel('rId10', 'image', '../media/ok.png'),
      rel('rId11', 'image', 'https://example.com/remote.png', 'External'),
      rel('rId12', 'image', '../../../outside.png'),
      rel('rId13', 'image', '../other/secret.png'),
    ].join('');
    const pics = ['rId10', 'rId11', 'rId12', 'rId13'].map((id) => `<p:pic><a:blip r:embed="${id}"/></p:pic>`).join('');
    const slideXml = `<p:sld xmlns:a="a" xmlns:r="r" xmlns:p="p">${pics}<a:p><a:r><a:t>${filler('text')}</a:t></a:r></a:p></p:sld>`;
    const patched = makePptx([{}], {
      media: { 'ok.png': TINY_PNG },
      files: {
        'ppt/other/secret.png': TINY_PNG,
        'ppt/slides/slide1.xml': slideXml,
        'ppt/slides/_rels/slide1.xml.rels': `<Relationships>${rels}</Relationships>`,
      },
    });
    const { media } = await extract(patched);
    expect(media.map((m) => m.name)).toEqual(['ok.png']);
  });

  it('follows an absolute media target', async () => {
    const bytes = makePptx([{ body: [filler('a')], pictures: ['abs.png'] }], {
      media: { 'abs.png': TINY_PNG },
      files: {
        'ppt/slides/_rels/slide1.xml.rels': `<Relationships>${rel('rId10', 'image', '/ppt/media/abs.png')}</Relationships>`,
      },
    });
    expect((await extract(bytes)).media.map((m) => m.name)).toEqual(['abs.png']);
  });

  it('lists a picture used on several slides once per slide, sharing the same bytes', async () => {
    const bytes = makePptx(
      [
        { body: [filler('a')], pictures: ['logo.png'] },
        { body: [filler('b')], pictures: ['logo.png'] },
      ],
      { media: { 'logo.png': TINY_PNG } },
    );
    const { media } = await extract(bytes);
    expect(media.map((m) => m.page)).toEqual([1, 2]);
    expect(media[0].bytes === media[1].bytes).toBe(true);
  });

  it('keeps at most 6 pictures per slide and 40 in total', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `p${i}.png`);
    const allMedia = Object.fromEntries(names.map((n) => [n, TINY_PNG]));
    const perSlide = await extract(makePptx([{ body: [filler('a')], pictures: names }], { media: allMedia }));
    expect(perSlide.media).toHaveLength(6);

    const slides = Array.from({ length: 10 }, () => ({ body: [filler('a')], pictures: names.slice(0, 5) }));
    const total = await extract(makePptx(slides, { media: allMedia }));
    expect(total.media).toHaveLength(40);
    expect(total.media[39].page).toBe(8);
  });
});

describe('PowerPoint extraction errors', () => {
  const codeOf = (promise: Promise<unknown>) => expect(promise).rejects;

  it('rejects bytes that are not a zip as unreadable', async () => {
    await codeOf(extract(new TextEncoder().encode('hello, not a zip'))).toMatchObject({ code: 'unreadable' });
    await codeOf(extract(new Uint8Array())).toBeInstanceOf(PptxExtractError);
  });

  it('rejects a damaged zip as unreadable', async () => {
    const zip = makePptx([{ body: [filler('a')] }]);
    await codeOf(extract(zip.slice(0, Math.floor(zip.length / 2)))).toMatchObject({ code: 'unreadable' });
  });

  it('reports a password-protected (OLE) .pptx as encrypted', async () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await codeOf(extract(ole, 'secret.pptx')).toMatchObject({ code: 'encrypted' });
    await codeOf(extract(ole, 'old.ppt')).toMatchObject({ code: 'not_presentation' });
  });

  it('rejects a zip with no presentation.xml, such as a renamed .docx', async () => {
    const docx = zipFiles({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' });
    await codeOf(extract(docx)).toMatchObject({ code: 'not_presentation' });
  });

  it('rejects presentations with too many slides', async () => {
    const slides = Array.from({ length: LIMITS.maxPages + 1 }, () => ({ body: ['x'] }));
    await codeOf(extract(makePptx(slides))).toMatchObject({ code: 'too_many_slides' });
  });

  it('rejects slides that have almost no text', async () => {
    await codeOf(extract(makePptx([{ title: 'Just a picture' }, {}]))).toMatchObject({ code: 'no_text' });
  });

  it('rejects an XML entry that declares more than 5 MB', async () => {
    const zip = declareSize(makePptx([{ body: [filler('a')] }]), 'ppt/slides/slide1.xml', 6 * 1024 * 1024);
    await codeOf(extract(zip)).toMatchObject({ code: 'too_large' });
  });

  it('never inflates an entry past the size it declares', async () => {
    // A zip that lies about its size cannot make the reader allocate more: the entry is cut at the declared size.
    const text = `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>${filler('x', 4000)}</a:t></a:r></a:p></p:sld>`;
    const honest = makePptx([{}], { files: { 'ppt/slides/slide1.xml': text } });
    expect((await extract(honest)).charCount).toBeGreaterThan(LIMITS.minChars);
    const lying = declareSize(honest, 'ppt/slides/slide1.xml', 100);
    await codeOf(extract(lying)).toMatchObject({ code: 'no_text' });
  });

  it('rejects an archive with too many entries', async () => {
    const files: Record<string, string> = { 'ppt/presentation.xml': '<p:presentation/>' };
    for (let i = 0; i < 5001; i++) files[`junk/${i}.txt`] = '';
    await codeOf(extract(zipFiles(files))).toMatchObject({ code: 'too_large' });
  });

  it('does not read XML entries whose names try to leave the folder', async () => {
    const zip = makePptx([{ body: [filler('a')] }], {
      files: { 'ppt/slides/../../evil.xml': '<p:sld><a:t>evil</a:t></p:sld>' },
    });
    const doc = await extract(zip);
    expect(doc.pages.map((p) => p.text).join(' ')).not.toContain('evil');
  });
});

describe('PowerPoint parser hardening', () => {
  const codeOf = (promise: Promise<unknown>) => expect(promise).rejects;
  const slide = (inner: string) => `<p:sld xmlns:a="a" xmlns:p="p">${inner}</p:sld>`;
  const withSlide = (xml: string) => makePptx([{}], { files: { 'ppt/slides/slide1.xml': xml } });

  /** Renames one zip entry in place (same length), so two entries end up with the same name. */
  const renameEntry = (zip: Uint8Array, from: string, to: string): Uint8Array => {
    const out = Buffer.from(zip);
    for (let at = out.indexOf(from); at !== -1; at = out.indexOf(from, at + 1)) out.write(to, at, 'latin1');
    return new Uint8Array(out);
  };

  it('rejects an archive in which two entries share a name', async () => {
    const zip = makePptx([{ body: [filler('a')] }], { files: { 'ppt/slides/slideX.xml': slide('<a:p><a:t>copy</a:t></a:p>') } });
    const duplicated = renameEntry(zip, 'ppt/slides/slideX.xml', 'ppt/slides/slide1.xml');
    await codeOf(extract(duplicated)).toMatchObject({ code: 'unreadable' });
  });

  it('rejects a part with unclosed tags instead of scanning it over and over', async () => {
    const started = Date.now();
    await codeOf(extract(withSlide(slide('<a:t '.repeat(300_000))))).toMatchObject({ code: 'unreadable' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('stays fast on hundreds of thousands of shapes that never close', async () => {
    const started = Date.now();
    const xml = slide(`${'<p:sp><p:pic><mc:Choice/><mc:Fallback>'.repeat(120_000)}<a:p><a:t>${filler('real')}</a:t></a:p>`);
    const doc = await extract(withSlide(xml));
    expect(doc.pages[0].text).toContain('real');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('still drops footers and keeps look-alike tag names', () => {
    const xml = slide(
      '<p:sp><p:spPr/><p:txBody><a:p><a:t>Kept body</a:t></a:p></p:txBody></p:sp>' +
        '<p:sp><p:nvSpPr><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:t>Footer text</a:t></a:p></p:txBody></p:sp>',
    );
    expect(textLines(xml)).toEqual(['Kept body']);
  });
});
