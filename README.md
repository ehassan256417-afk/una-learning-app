# UNA Learning — Mobile-first Prototype

Independent student project for UNA students. **Not affiliated with or endorsed by the University of North Alabama.** The lion mascot is original SVG artwork for this project; no official university marks are used.

## Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 (best viewed at phone width).

```bash
npm run lint    # TypeScript check
npm run build   # production build
```

## Screens

| Route | Screen |
| --- | --- |
| `/` | Dashboard: stats, Start Learning, courses, badges |
| `/courses` | Course list |
| `/courses/[courseId]` | Learning path (sections unlock in order) |
| `/courses/[courseId]/[sectionId]` | Pre-lesson: objectives, reward, key points, source |
| `/courses/[courseId]/[sectionId]/lesson` | Lesson player: notes, 3-level quiz, flashcards, results |
| `/upload` | PDF picker (local validation only) and the planned pipeline |
| `/progress` | Level, streak, course progress, badges |
| `/profile` | Display name, project notices, reset progress |

## Demo data

- All courses, lessons, questions and starting stats are **sample content** in `lib/learning/demo-data.ts`. Nothing was extracted from or verified against a real PDF.
- Every content item carries `provenance: { kind: 'demo' }`, and the UI shows a "Demo" label wherever it appears.
- Progress is stored in the browser (`localStorage`, key `una-learning:progress:v1`). No accounts, no server, no AI calls, no paid APIs.
- Choosing a PDF on the Upload screen does not upload or read the file.

## Structure

```
app/                 routes (server components that load data from the engine)
components/          screens and shared UI (client components)
lib/learning/
  types.ts           domain model, including Provenance and SourceCitation
  engine.ts          LearningEngine interface + demo implementation
  grounding.ts       validator that rejects uncited generated content
  demo-data.ts       sample courses
lib/progress/        local progress store and derived badges
```

## Preparing for the PDF AI Learning Engine

The UI only talks to `getLearningEngine()` in `lib/learning/engine.ts`. To add the real engine:

1. Implement `LearningEngine` (`listCourses`, `getCourse`, `getSection`, `ingestPdf`) against private storage.
2. Extract PDF text per page and keep page numbers with every chunk.
3. Generate sections from retrieved chunks only, emitting `provenance: { kind: 'pdf', documentId, citations }`.
4. Run `validateSectionGrounding` on every section and drop anything it flags.
5. Return the new engine from `getLearningEngine()`. Screens already render page citations for non-demo content.

Before a pilot: private storage, access control, rate limiting, unsupported-content rejection and a privacy review.
