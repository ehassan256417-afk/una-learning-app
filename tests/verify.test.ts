import { describe, it } from 'node:test';
import { expect } from './helpers/expect.ts';
import { checkCitation, claimSupport, normalizeText, PageIndex, verifyItem } from '../lib/learning/verify.ts';

const pages = [
  {
    page: 1,
    text: 'Photosynthesis takes place in the chloroplasts of plant cells. Chlorophyll absorbs light energy, mainly from the blue and red parts of the spectrum.',
  },
  {
    page: 2,
    text: 'The Calvin cycle uses ATP and NADPH to turn carbon dioxide into glucose. It takes place in the stroma of the chloroplast.',
  },
];
const index = new PageIndex(pages);

describe('normalizeText', () => {
  it('ignores case, punctuation and extra whitespace', () => {
    expect(normalizeText('  The  Calvin-cycle, uses ATP!  ')).toBe('the calvin cycle uses atp');
  });
});

describe('checkCitation', () => {
  it('accepts a quote found word for word on the cited page', () => {
    const r = checkCitation({ page: 1, quote: 'Chlorophyll absorbs light energy, mainly from the blue and red parts' }, index);
    expect(r).toMatchObject({ ok: true, page: 1, support: 'exact' });
  });

  it('corrects the page number when the exact quote is on another page', () => {
    const r = checkCitation({ page: 1, quote: 'It takes place in the stroma of the chloroplast' }, index);
    expect(r).toMatchObject({ ok: true, page: 2, support: 'exact' });
  });

  it('accepts a quote with one small difference as a close match', () => {
    const r = checkCitation(
      { page: 2, quote: 'The Calvin cycle uses ATP and NADPH to convert carbon dioxide into glucose' },
      index,
    );
    expect(r).toMatchObject({ ok: true, page: 2, support: 'close' });
  });

  it('rejects an invented quote', () => {
    const r = checkCitation({ page: 1, quote: 'Mitochondria are the powerhouse of the cell and produce oxygen' }, index);
    expect(r.ok).toBe(false);
  });

  it('rejects quotes that are too short to mean anything', () => {
    expect(checkCitation({ page: 1, quote: 'plant cells' }, index).ok).toBe(false);
  });

  it('rejects a page that does not exist', () => {
    const r = checkCitation({ page: 9, quote: 'Glucose is stored as starch in the roots of the plant' }, index);
    expect(r).toMatchObject({ ok: false });
  });
});

describe('claimSupport', () => {
  it('is high when the claim reuses the page vocabulary', () => {
    expect(claimSupport('Chlorophyll absorbs light energy in chloroplasts.', [1], index)).toBeGreaterThanOrEqual(0.8);
  });

  it('is low for a claim about something the page never mentions', () => {
    expect(claimSupport('Napoleon invaded Russia during the winter campaign.', [1], index)).toBeLessThan(0.3);
  });
});

describe('verifyItem', () => {
  const quote = 'The Calvin cycle uses ATP and NADPH to turn carbon dioxide into glucose';

  it('keeps a supported claim and returns its citations', () => {
    const r = verifyItem('The Calvin cycle turns carbon dioxide into glucose using ATP and NADPH.', [{ page: 2, quote }], index, 'doc1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.citations[0]).toMatchObject({ documentId: 'doc1', page: 2, support: 'exact' });
  });

  it('drops an item with no citation', () => {
    expect(verifyItem('The Calvin cycle makes glucose.', [], index, 'doc1').ok).toBe(false);
  });

  it('drops a real quote attached to an unrelated claim', () => {
    const r = verifyItem('Vaccines train the immune system to recognise viruses quickly.', [{ page: 2, quote }], index, 'doc1');
    expect(r.ok).toBe(false);
  });

  it('drops a claim whose only citation is fabricated', () => {
    const r = verifyItem('Chlorophyll absorbs light energy.', [{ page: 1, quote: 'Chlorophyll reflects every colour of light equally well' }], index, 'doc1');
    expect(r.ok).toBe(false);
  });
});
