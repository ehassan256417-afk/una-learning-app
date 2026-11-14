import { unzipSync } from 'fflate';
import { LIMITS, type ExtractedDocument, type ExtractedPage } from '../learning/contracts.ts';
import { cleanPageText, documentIdFor } from '../pdf/extract.ts';

/**
 * PowerPoint (.pptx) text extraction. Slide N becomes page N.
 *
 * A .pptx is a zip of XML parts. Everything here runs on the student's device
 * (browser or Node tests): the file itself is never sent anywhere, only the
 * extracted text. The archive is untrusted input, so entry sizes and counts are
 * checked from the zip directory before anything is inflated.
 */

export type PptxExtractErrorCode =
  | 'unreadable'
  | 'encrypted'
  | 'not_presentation'
  | 'too_many_slides'
  | 'too_large'
  | 'no_text';

export class PptxExtractError extends Error {
  code: PptxExtractErrorCode;

  constructor(code: PptxExtractErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PptxExtractError';
  }
}

export type SlideMediaMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface SlideMedia {
  /** 1-based slide number the picture appears on. */
  page: number;
  /** File name inside the presentation, e.g. "image1.png". */
  name: string;
  mime: SlideMediaMime;
  bytes: Uint8Array;
}

export type PptxDocument = ExtractedDocument & { sourceKind: 'pptx'; media: SlideMedia[] };

/** Zip-safety and media caps. */
const ZIP_LIMITS = {
  maxEntries: 5000,
  maxXmlBytes: 5 * 1024 * 1024,
  maxMediaBytes: 3 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  maxMediaPerSlide: 6,
  maxMediaTotal: 40,
} as const;

const TOO_LARGE_MESSAGE = 'This presentation is too large or has an unusual structure, so it cannot be read safely.';
const DAMAGED_MESSAGE = 'This presentation could not be read. It may be damaged.';

// ---------------------------------------------------------------- zip access

/** Names and declared sizes of every entry. Nothing is inflated here. */
function listEntries(data: Uint8Array): Map<string, number> {
  const entries = new Map<string, number>();
  let count = 0;
  let duplicate = false;
  try {
    unzipSync(data, {
      filter: (file) => {
        count++;
        // Two entries with one name would let the second escape the size checks made on the first.
        if (entries.has(file.name)) duplicate = true;
        if (count <= ZIP_LIMITS.maxEntries) entries.set(file.name, file.originalSize);
        return false;
      },
    });
  } catch {
    throw new PptxExtractError('unreadable', DAMAGED_MESSAGE);
  }
  if (count > ZIP_LIMITS.maxEntries) throw new PptxExtractError('too_large', TOO_LARGE_MESSAGE);
  if (duplicate) throw new PptxExtractError('unreadable', DAMAGED_MESSAGE);
  return entries;
}

/** Entry names with `..`, a leading slash or backslashes are never read. */
const isSafeEntryName = (name: string) =>
  !name.includes('..') && !name.startsWith('/') && !name.includes('\\') && !name.endsWith('/');

function inflate(data: Uint8Array, names: Set<string>): Record<string, Uint8Array> {
  if (names.size === 0) return {};
  try {
    return unzipSync(data, { filter: (file) => names.has(file.name) });
  } catch {
    throw new PptxExtractError('unreadable', DAMAGED_MESSAGE);
  }
}

const NEEDED_XML =
  /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(?:_rels\/)?[^/]+\.(?:xml|rels)|notesSlides\/[^/]+\.xml)$/;

/** Inflates only the XML parts needed for text, after checking their declared sizes. */
function readXmlParts(data: Uint8Array, entries: Map<string, number>): Map<string, string> {
  const wanted = new Set<string>();
  let total = 0;
  for (const [name, size] of entries) {
    if (!isSafeEntryName(name) || !NEEDED_XML.test(name)) continue;
    if (size > ZIP_LIMITS.maxXmlBytes) throw new PptxExtractError('too_large', TOO_LARGE_MESSAGE);
    total += size;
    if (total > ZIP_LIMITS.maxTotalBytes) throw new PptxExtractError('too_large', TOO_LARGE_MESSAGE);
    wanted.add(name);
  }
  const parts = new Map<string, string>();
  const decoder = new TextDecoder('utf-8');
  for (const [name, bytes] of Object.entries(inflate(data, wanted))) {
    // The declared size is only a claim; check what was really produced.
    if (bytes.length > ZIP_LIMITS.maxXmlBytes) throw new PptxExtractError('too_large', TOO_LARGE_MESSAGE);
    const xml = decoder.decode(bytes);
    assertTagsClosed(xml);
    parts.set(name, xml);
  }
  return parts;
}

// ------------------------------------------------------ XML and entity helpers

/**
 * Every "<" must be closed by a ">" before the next "<", as it is in any file
 * PowerPoint writes. The tag patterns below rely on this: without it, a crafted
 * part with thousands of unclosed tags makes them rescan the whole text for
 * each one and freezes the page.
 */
function assertTagsClosed(xml: string): void {
  let open = xml.indexOf('<');
  while (open !== -1) {
    const close = xml.indexOf('>', open + 1);
    const next = xml.indexOf('<', open + 1);
    if (close === -1 || (next !== -1 && next < close)) throw new PptxExtractError('unreadable', DAMAGED_MESSAGE);
    open = next;
  }
}

const NAME_CHAR = /[\w:.-]/;

/**
 * Start and end offsets of each `<tag ...>...</tag>` element, found with plain
 * forward searches so the cost stays proportional to the text length. Once a
 * closing tag is missing there can be no further element, so the scan stops.
 */
function elementSpans(xml: string, tag: string): Array<[number, number]> {
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const start = xml.indexOf(openTag, from);
    if (start === -1) break;
    // "<p:sp" must not match "<p:spPr".
    if (NAME_CHAR.test(xml[start + openTag.length] ?? '')) {
      from = start + openTag.length;
      continue;
    }
    const close = xml.indexOf(closeTag, start + openTag.length);
    if (close === -1) break;
    spans.push([start, close + closeTag.length]);
    from = close + closeTag.length;
  }
  return spans;
}

/** The text with every `<tag>` element removed for which `drop` returns true. */
function dropElements(xml: string, tag: string, drop: (element: string) => boolean): string {
  let out = '';
  let from = 0;
  for (const [start, end] of elementSpans(xml, tag)) {
    if (!drop(xml.slice(start, end))) continue;
    out += xml.slice(from, start);
    from = end;
  }
  return from === 0 ? xml : out + xml.slice(from);
}

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes XML entities in one pass, so "&amp;lt;" correctly becomes "&lt;". */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (_all, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body] ?? '';
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : '';
  });
}

const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(ATTRIBUTE)) attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  return attrs;
}

// -------------------------------------------------------------- relationships

interface Relationship {
  id: string;
  type: string;
  /** Resolved zip path, or null for external or unsafe targets. */
  path: string | null;
}

/** Resolves a relationship target against the folder of the part that owns it. */
export function resolveTarget(baseDir: string, target: string): string | null {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // keep the raw target; it will simply not match an entry
  }
  if (decoded.includes('\\')) return null;
  const parts: string[] = [];
  for (const seg of (decoded.startsWith('/') ? decoded.slice(1) : baseDir + decoded).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null; // would climb out of the archive
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length ? parts.join('/') : null;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

const relsPathFor = (part: string) => `${dirOf(part)}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`;

function parseRelationships(xml: string | undefined, partPath: string): Relationship[] {
  if (!xml) return [];
  const baseDir = dirOf(partPath);
  const rels: Relationship[] = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = parseAttributes(m[0]);
    if (!a.Id || !a.Type || a.Target === undefined) continue;
    const external = (a.TargetMode ?? '').toLowerCase() === 'external';
    rels.push({ id: a.Id, type: a.Type, path: external ? null : resolveTarget(baseDir, a.Target) });
  }
  return rels;
}

const hasTypeSuffix = (rel: Relationship, suffix: string) => rel.type.endsWith(`/${suffix}`);

// ---------------------------------------------------------------- slide order

/** Slide parts in presentation order, from `<p:sldIdLst>` and the presentation rels. */
function slidesFromPresentation(parts: Map<string, string>): string[] {
  const xml = parts.get('ppt/presentation.xml') ?? '';
  const rels = parseRelationships(parts.get('ppt/_rels/presentation.xml.rels'), 'ppt/presentation.xml');
  const byId = new Map(rels.filter((r) => hasTypeSuffix(r, 'slide') && r.path).map((r) => [r.id, r.path as string]));
  const [span] = elementSpans(xml, 'p:sldIdLst');
  const list = span ? xml.slice(span[0], span[1]) : '';
  const ordered: string[] = [];
  for (const m of list.matchAll(/<p:sldId\b[^>]*>/g)) {
    const path = byId.get(parseAttributes(m[0])['r:id']);
    if (path && parts.has(path)) ordered.push(path);
  }
  return ordered;
}

/** Fallback when the presentation index is unusable: slide1.xml, slide2.xml, ... */
function slidesByNumber(parts: Map<string, string>): string[] {
  const numbered: Array<{ n: number; path: string }> = [];
  for (const path of parts.keys()) {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
    if (m) numbered.push({ n: Number(m[1]), path });
  }
  return numbered.sort((a, b) => a.n - b.n).map((s) => s.path);
}

function orderedSlides(parts: Map<string, string>): string[] {
  const fromIndex = slidesFromPresentation(parts);
  return fromIndex.length ? fromIndex : slidesByNumber(parts);
}

// ------------------------------------------------------------------ slide text

/** Footers, dates and slide numbers repeat on every slide and carry no teaching content. */
const BOILERPLATE_PLACEHOLDER = /<p:ph\b[^>]*\btype="(?:sldNum|dt|ftr|hdr)"/;

/** Drops boilerplate shapes, and the Fallback copy of content that has a Choice. */
function prepareXml(xml: string): string {
  const out = xml.includes('<mc:Choice') ? dropElements(xml, 'mc:Fallback', () => true) : xml;
  return dropElements(out, 'p:sp', (shape) => BOILERPLATE_PLACEHOLDER.test(shape));
}

/** Text runs, line breaks and the structure tags that matter, in document order. */
const TOKEN = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*>|<(\/?)a:(tbl|tr|tc|p)\b[^>]*?(\/?)>/g;

/**
 * One string per paragraph. A table becomes a single line: cells joined with
 * " | " and rows with "; ", so it reads as plain text.
 */
export function textLines(rawXml: string): string[] {
  const lines: string[] = [];
  let paragraph = '';
  let inTable = false;
  let rows: string[] = [];
  let row: string[] = [];
  let cell: string[] = [];

  const endParagraph = () => {
    const text = paragraph.trim();
    paragraph = '';
    if (text) (inTable ? cell : lines).push(text);
  };
  const endCell = () => {
    const text = cell.join(' ');
    cell = [];
    if (text) row.push(text);
  };
  const endRow = () => {
    if (row.length) rows.push(row.join(' | '));
    row = [];
  };

  for (const m of prepareXml(rawXml).matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      paragraph += decodeXmlEntities(m[1]);
    } else if (!m[3]) {
      paragraph += ' '; // <a:br/>
    } else if (m[4]) {
      continue; // self-closing, e.g. <a:p/>: nothing inside
    } else {
      const closing = m[2] === '/';
      switch (m[3]) {
        case 'p':
          if (closing) endParagraph();
          else paragraph = '';
          break;
        case 'tc':
          if (closing) endCell();
          else cell = [];
          break;
        case 'tr':
          if (closing) endRow();
          else row = [];
          break;
        default: // tbl
          if (closing) {
            if (rows.length) lines.push(rows.join('; '));
            inTable = false;
          } else {
            inTable = true;
            rows = [];
          }
      }
    }
  }
  return lines;
}

function notesText(slideRels: Relationship[], parts: Map<string, string>): string {
  const notesPath = slideRels.find((r) => hasTypeSuffix(r, 'notesSlide'))?.path;
  const xml = notesPath ? parts.get(notesPath) : undefined;
  if (!xml) return '';
  const text = textLines(xml).join(' ').trim();
  return text ? `Speaker notes: ${text}` : '';
}

interface SlideSource {
  page: number;
  path: string;
  xml: string;
  rels: Relationship[];
}

function slideText(slide: SlideSource, parts: Map<string, string>): string {
  const lines = textLines(slide.xml);
  const notes = notesText(slide.rels, parts);
  if (notes) lines.push(notes);
  return cleanPageText(lines.join('\n'));
}

// ----------------------------------------------------------------------- media

const MEDIA_TYPES: Record<string, SlideMediaMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Content must match the claimed type: a renamed file is not an image. */
function matchesMagic(mime: SlideMediaMime, b: Uint8Array): boolean {
  switch (mime) {
    case 'image/png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(b, [0x47, 0x49, 0x46, 0x38]);
    default: // webp: "RIFF" + size + "WEBP"
      return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
  }
}

const mimeForPath = (path: string): SlideMediaMime | undefined =>
  MEDIA_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];

/** Relationship ids of pictures placed on the slide itself (not layout or master decoration). */
function pictureRelIds(slideXml: string): string[] {
  const ids: string[] = [];
  const xml = prepareXml(slideXml);
  for (const [start, end] of elementSpans(xml, 'p:pic')) {
    for (const blip of xml.slice(start, end).matchAll(/<a:blip\b[^>]*>/g)) {
      const id = parseAttributes(blip[0])['r:embed'];
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

interface MediaRef {
  page: number;
  path: string;
  mime: SlideMediaMime;
}

/** Which media files to read, applying the extension, size and count caps. */
function planMedia(slides: SlideSource[], entries: Map<string, number>): { refs: MediaRef[]; files: Set<string> } {
  const refs: MediaRef[] = [];
  const files = new Set<string>();
  let inflated = 0;
  for (const slide of slides) {
    let onSlide = 0;
    for (const id of pictureRelIds(slide.xml)) {
      const path = slide.rels.find((r) => r.id === id && hasTypeSuffix(r, 'image'))?.path;
      const mime = path ? mimeForPath(path) : undefined;
      const size = path ? entries.get(path) : undefined;
      if (!path || !mime || size === undefined || !isSafeEntryName(path) || !path.startsWith('ppt/media/')) continue;
      if (size === 0 || size > ZIP_LIMITS.maxMediaBytes) continue;
      if (onSlide >= ZIP_LIMITS.maxMediaPerSlide || refs.length >= ZIP_LIMITS.maxMediaTotal) continue;
      if (!files.has(path)) {
        if (inflated + size > ZIP_LIMITS.maxTotalBytes) continue;
        inflated += size;
        files.add(path);
      }
      refs.push({ page: slide.page, path, mime });
      onSlide++;
    }
  }
  return { refs, files };
}

function readMedia(data: Uint8Array, slides: SlideSource[], entries: Map<string, number>): SlideMedia[] {
  const { refs, files } = planMedia(slides, entries);
  const bytesByPath = inflate(data, files);
  const media: SlideMedia[] = [];
  for (const ref of refs) {
    const bytes = bytesByPath[ref.path];
    if (!bytes || bytes.length > ZIP_LIMITS.maxMediaBytes || !matchesMagic(ref.mime, bytes)) continue;
    media.push({ page: ref.page, name: ref.path.slice(ref.path.lastIndexOf('/') + 1), mime: ref.mime, bytes });
  }
  return media;
}

// ------------------------------------------------------------------ entry point

/** Password-protected Office files are OLE compound files, not zips. */
const isOleFile = (b: Uint8Array) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]);
const isZipFile = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);

function assertZip(data: Uint8Array, name: string) {
  if (isZipFile(data)) return;
  if (isOleFile(data)) {
    if (name.toLowerCase().endsWith('.pptx')) {
      throw new PptxExtractError('encrypted', 'This presentation is password-protected. Remove the password and try again.');
    }
    throw new PptxExtractError('not_presentation', 'This looks like an old .ppt file. Save it as .pptx and try again.');
  }
  throw new PptxExtractError('unreadable', DAMAGED_MESSAGE);
}

function loadSlides(parts: Map<string, string>): SlideSource[] {
  return orderedSlides(parts).map((path, i) => ({
    page: i + 1,
    path,
    xml: parts.get(path) ?? '',
    rels: parseRelationships(parts.get(relsPathFor(path)), path),
  }));
}

export async function extractPptxText(
  data: Uint8Array,
  name: string,
  onProgress?: (slide: number, total: number) => void,
): Promise<PptxDocument> {
  assertZip(data, name);
  const entries = listEntries(data);
  if (!entries.has('ppt/presentation.xml')) {
    throw new PptxExtractError('not_presentation', 'This file is not a PowerPoint presentation.');
  }
  const parts = readXmlParts(data, entries);
  const slides = loadSlides(parts);
  if (slides.length > LIMITS.maxPages) {
    throw new PptxExtractError(
      'too_many_slides',
      `This presentation has ${slides.length} slides. The limit is ${LIMITS.maxPages}; try uploading part of it.`,
    );
  }

  const pages: ExtractedPage[] = [];
  const processed: SlideSource[] = [];
  let charCount = 0;
  let truncated = false;
  for (const slide of slides) {
    onProgress?.(slide.page, slides.length);
    processed.push(slide);
    let text = slideText(slide, parts);
    if (!text) continue; // no text: pictures only, or empty
    if (charCount + text.length > LIMITS.maxChars) {
      text = text.slice(0, Math.max(0, LIMITS.maxChars - charCount));
      truncated = true;
    }
    if (text) pages.push({ page: slide.page, text });
    charCount += text.length;
    if (truncated) break;
  }
  if (charCount < LIMITS.minChars) {
    throw new PptxExtractError(
      'no_text',
      'Not enough readable text was found. These slides seem to be mostly images, which are not supported yet.',
    );
  }
  const media = readMedia(data, processed, entries);
  return {
    id: await documentIdFor(pages),
    name,
    pageCount: slides.length,
    pages,
    charCount,
    truncated,
    sourceKind: 'pptx',
    media,
  };
}
