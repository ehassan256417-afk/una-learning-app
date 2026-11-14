import { strToU8, zipSync } from 'fflate';

/**
 * Builds small synthetic .pptx files in memory, so no presentation files live
 * in the repo. Covers just enough DrawingML for the extractor: title and body
 * paragraphs, a table, a grouped shape, speaker notes and embedded pictures.
 */

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A real 1x1 PNG. */
export const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
/** Starts like a JPEG (enough for the signature check). */
export const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const TINY_GIF = strToU8('GIF89a\u0001\u0000\u0001\u0000');
export const TINY_WEBP = strToU8('RIFF\u0004\u0000\u0000\u0000WEBP');

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SlideSpec {
  title?: string;
  /** One paragraph each. A "\n" inside a string becomes an <a:br/>. */
  body?: string[];
  /** Rows of cells. */
  table?: string[][];
  /** Paragraphs inside a grouped shape. */
  group?: string[];
  notes?: string;
  /** Names from `media` shown as pictures on this slide. */
  pictures?: string[];
  /** Raw XML placed in the shape tree (already escaped). */
  rawShapes?: string;
  /** Extra Relationship elements for the slide's rels part. */
  extraRels?: string[];
}

export interface PptxOptions {
  /** Media files under ppt/media (name -> bytes), whether or not a slide uses them. */
  media?: Record<string, Uint8Array>;
  /** 1-based slide numbers in the order presentation.xml lists them (default: 1..n). */
  order?: number[];
  /** Raw zip entries to add or override; null removes an entry. */
  files?: Record<string, Uint8Array | string | null>;
}

const paragraph = (text: string) =>
  `<a:p>${text
    .split('\n')
    .map((line) => `<a:r><a:t>${escapeXml(line)}</a:t></a:r>`)
    .join('<a:br/>')}</a:p>`;

const textShape = (id: number, paras: string[], ph = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
  `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras.map((t) => paragraph(t)).join('')}</p:txBody></p:sp>`;

const tableFrame = (rows: string[][]) =>
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="50" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid/>' +
  rows
    .map(
      (cells) =>
        `<a:tr h="100">${cells
          .map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraph(c)}</a:txBody><a:tcPr/></a:tc>`)
          .join('')}</a:tr>`,
    )
    .join('') +
  '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';

const picture = (rId: string, n: number) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${60 + n}" name="Picture ${n}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch/></p:blipFill><p:spPr/></p:pic>`;

function slideXml(spec: SlideSpec, pictureIds: string[]): string {
  const shapes: string[] = [];
  if (spec.title) shapes.push(textShape(2, [spec.title], '<p:ph type="title"/>'));
  if (spec.body) shapes.push(textShape(3, spec.body, '<p:ph idx="1"/>'));
  if (spec.table) shapes.push(tableFrame(spec.table));
  if (spec.group) {
    shapes.push(`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="40" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${textShape(41, spec.group)}</p:grpSp>`);
  }
  pictureIds.forEach((id, i) => shapes.push(picture(id, i + 1)));
  if (spec.rawShapes) shapes.push(spec.rawShapes);
  // Slide number placeholder, like PowerPoint writes it: must not appear in the text.
  shapes.push(
    '<p:sp><p:nvSpPr><p:cNvPr id="90" name="Slide Number"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr>' +
      '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p></p:txBody></p:sp>',
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;
}

function notesXml(text: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    textShape(3, [text], '<p:ph type="body" idx="1"/>') +
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{2}" type="slidenum"><a:t>3</a:t></a:fld></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:notes>'
  );
}

const relsXml = (rels: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;

export const rel = (id: string, type: string, target: string, mode?: string) =>
  `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`;

export function makePptx(slides: SlideSpec[], options: PptxOptions = {}): Uint8Array {
  const files: Record<string, Uint8Array | string | null> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  };
  for (const [name, bytes] of Object.entries(options.media ?? {})) files[`ppt/media/${name}`] = bytes;

  slides.forEach((spec, i) => {
    const n = i + 1;
    const rels: string[] = [];
    const pictureIds = (spec.pictures ?? []).map((name, k) => {
      const id = `rId${10 + k}`;
      rels.push(rel(id, 'image', `../media/${name}`));
      return id;
    });
    if (spec.notes !== undefined) {
      rels.push(rel('rId2', 'notesSlide', `../notesSlides/notesSlide${n}.xml`));
      files[`ppt/notesSlides/notesSlide${n}.xml`] = notesXml(spec.notes);
    }
    rels.push(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'), ...(spec.extraRels ?? []));
    files[`ppt/slides/slide${n}.xml`] = slideXml(spec, pictureIds);
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = relsXml(rels);
  });

  const order = options.order ?? slides.map((_, i) => i + 1);
  files['ppt/presentation.xml'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldMasterIdLst/>` +
    `<p:sldIdLst>${order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + n}"/>`).join('')}</p:sldIdLst></p:presentation>`;
  files['ppt/_rels/presentation.xml.rels'] = relsXml([
    rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'),
    ...slides.map((_, i) => rel(`rId${101 + i}`, 'slide', `slides/slide${i + 1}.xml`)),
  ]);

  Object.assign(files, options.files);
  return zipFiles(files);
}

/** Zips a name -> content map, dropping entries set to null. */
export function zipFiles(files: Record<string, Uint8Array | string | null>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    if (content !== null) entries[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(entries);
}

/** Rewrites the uncompressed size the zip directory declares for one entry (to test size guards). */
export function declareSize(zip: Uint8Array, entryName: string, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const wanted = strToU8(entryName);
  for (let i = 0; i + 46 < out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLen = view.getUint16(i + 28, true);
    const name = out.subarray(i + 46, i + 46 + nameLen);
    if (nameLen === wanted.length && wanted.every((b, k) => name[k] === b)) view.setUint32(i + 24, size, true);
  }
  return out;
}

/** Text long enough to clear LIMITS.minChars. */
export const filler = (label: string, words = 80) =>
  `${label}: ${Array.from({ length: words }, (_, i) => `term${i}`).join(' ')}.`;
