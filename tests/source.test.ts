import { describe, it } from 'node:test';
import { assembleCourse, type CourseMeta } from '../lib/learning/adaptive.ts';
import { sourceName, sourceUnit, type LessonPlan } from '../lib/learning/types.ts';
import { expect } from './helpers/expect.ts';

const plan: LessonPlan = { version: 1, title: '', concepts: [], lessons: [], flagged: [], pageChars: [] };
const report = { checked: 0, kept: 0, dropped: 0, reasons: [] };
const meta = (extra: Partial<CourseMeta>): CourseMeta => ({
  documentId: 'abcdef0123456789',
  documentName: 'Week 3 - Cells.pptx',
  pageCount: 12,
  provider: 'mock',
  model: 'mock',
  createdAt: '2026-11-13T00:00:00.000Z',
  ...extra,
});

describe('courses built from slides', () => {
  it('labels a presentation as slides and drops the .pptx ending from its name', () => {
    const course = assembleCourse(meta({ sourceKind: 'pptx' }), plan, [], [], report);
    expect(course.sourceKind).toBe('pptx');
    expect(course.unitLabel).toBe('Your slides');
    expect(course.unitTitle).toBe('Week 3 - Cells');
    expect(sourceUnit(course)).toBe('slide');
    expect(sourceName(course)).toBe('slides');
  });

  it('keeps a PDF course exactly as before, with no source kind stored', () => {
    const course = assembleCourse(meta({ documentName: 'Chapter 4.pdf' }), plan, [], [], report);
    expect('sourceKind' in course).toBe(false);
    expect(course.unitLabel).toBe('Your PDF');
    expect(course.code).toBe('PDF');
    expect(course.unitTitle).toBe('Chapter 4');
    expect(sourceUnit(course)).toBe('page');
  });
});
