import type { Provenance, Section } from './types.ts';

/**
 * Grounding rules for generated content.
 *
 * The future PDF engine must run every generated section through
 * `validateSectionGrounding` and reject (not display) anything that fails.
 * Demo content is exempt because it is always labeled as demo in the UI.
 */

export interface GroundingIssue {
  itemId: string;
  reason: string;
}

const MIN_EXCERPT_LENGTH = 20;

export function checkProvenance(itemId: string, p: Provenance): GroundingIssue[] {
  if (p.kind === 'demo') return [];
  const issues: GroundingIssue[] = [];
  if (p.citations.length === 0) {
    issues.push({ itemId, reason: 'No source citation: content is not grounded in the PDF.' });
  }
  for (const c of p.citations) {
    if (c.documentId !== p.documentId) {
      issues.push({ itemId, reason: `Citation points at a different document (${c.documentId}).` });
    }
    if (!Number.isInteger(c.page) || c.page < 1) {
      issues.push({ itemId, reason: `Invalid page number: ${c.page}.` });
    }
    if (c.excerpt.trim().length < MIN_EXCERPT_LENGTH) {
      issues.push({ itemId, reason: 'Excerpt is too short to verify the claim.' });
    }
  }
  return issues;
}

export function validateSectionGrounding(section: Section): GroundingIssue[] {
  return [
    ...checkProvenance(section.id, section.provenance),
    ...section.notes.flatMap((n) => checkProvenance(n.id, n.provenance)),
    ...section.questions.flatMap((q) => checkProvenance(q.id, q.provenance)),
    ...section.flashcards.flatMap((f) => checkProvenance(f.id, f.provenance)),
  ];
}
