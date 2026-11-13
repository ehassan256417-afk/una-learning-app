# UNA Learning

Mobile-first study app that turns course PDFs into short lessons, quizzes and flashcards.

Independent student project for UNA students. **Not affiliated with or endorsed by the University of North Alabama.** The lion mascot is original artwork; no official university marks are used.

Live demo (static frontend): https://ehassan256417-afk.github.io/una-learning-app/

## What works

| Area | Status |
| --- | --- |
| Dashboard, learning path, pre-lesson, lesson, quiz, flashcards, progress, profile | Working, with demo courses labeled "Demo" |
| PDF upload with validation (type, size, file signature, page limit, scanned-PDF detection) | Working in the browser |
| PDF text extraction with page numbers | Working in the browser; the file never leaves the device |
| Lesson backend (`server/`) with provider abstraction | Working locally |
| Offline sample provider (no AI, no key) | Working, used by tests and local development |
| ZRO provider (primary, `deepseek-v4.1-flash`) | Implemented from the ZRO API reference and unit-tested against a mocked API. **Not yet run against the real API** (needs a key) |
| Gemini provider (optional) | Kept as an alternative. Run against the real API on 2026-11-13: the default model `gemini-2.5-flash` is retired for new keys, newer models often returned HTTP 503, and the 8,192 output-token cap cut lessons off. Not recommended without changes |
| Grounding check of generated content against the PDF | Working |
| Saved lessons (no repeated AI requests) | Working: browser storage plus a short-lived backend cache |
| Hosted AI backend | **Not deployed.** The live site shows "not connected" on the Upload screen |

## Run it

Requires Node 24 or newer.

```bash
npm install
npm run dev        # frontend at http://localhost:3000
npm run server     # lesson backend at http://127.0.0.1:8787 (second terminal)
```

Without a key the backend runs in **offline sample mode**: it builds lessons by copying sentences from the PDF and blanking out words. That exercises the whole flow but is not AI.

To use real AI, copy `server/.env.example` to `.env` in the project root and set `ZRO_API_KEY` (create it at https://zro.moonmath.ai under Account, API keys; give the key a spend quota and an expiry date). `.env` is git-ignored. Optional settings: `ZRO_MODEL`, `ZRO_REASONING_EFFORT` (`none`, `low`, `high`, `max`; default `low`) and `ZRO_MAX_TOKENS` (default 16000). ZRO bills by usage: its pricing page lists free daily usage on `deepseek-v4.1-flash`, and anything beyond that draws on a plan or usage pack.

`node scripts/validate-provider.ts zro biology` runs the pipeline against the live provider with a synthetic sample PDF and writes a report (timing, token usage, kept and dropped items) to the git-ignored `.claude/validation/`. It makes real API calls, so run it on purpose.

```bash
npm test           # 78 tests, Node's built-in runner
npm run lint       # TypeScript check
npm run build      # production build
```

## Architecture

```
Browser (GitHub Pages, static)                Lesson backend (server/, not deployed)
------------------------------                -------------------------------------
PDF file  -> validate -> extract text         POST /api/lessons/generate
             (pdf.js, on device)       ---->    validate request, rate-limit
only { page, text } is sent                     AI provider (ZRO | offline mock)   
                                                parse JSON, check every item against
course saved in browser storage  <----          the page text, drop what fails
opened via /my?c=...                            return verified course
```

- **The PDF file is never uploaded.** Text is extracted in the browser and only that text is sent to the backend.
- **API keys live only on the backend.** No key, provider URL or backend address is in the Pages bundle.
- **Nothing private goes to GitHub.** `*.pdf` and `.env*` are git-ignored; test PDFs are synthetic and generated in memory.
- **Lessons are stored on the student's device** (`localStorage`). The backend keeps results in memory only, for up to 24 hours, keyed by a hash of the text.

```
app/                 routes; /my opens PDF courses from browser storage
components/          screens and shared UI
lib/pdf/             validation and page-level text extraction
lib/learning/        types, API contracts, grounding verification, browser store
server/              HTTP API, generation pipeline, providers, request guards
tests/               unit and end-to-end tests with sample PDFs (biology, history, computing)
```

## Lesson format

The provider must return JSON with three sections (Beginner, Intermediate, Advanced). Each has objectives, key points, notes, three questions (difficulty 1 to 3) and flashcards. Every note, key point, question and flashcard carries citations:

```json
{ "page": 2, "quote": "exact words copied from page 2" }
```

See `server/prompt.ts` (instructions) and `server/schema.ts` (validation).

## Grounding verification, and its limits

For every generated item, `lib/learning/verify.ts` checks that:

1. each cited quote really appears in the PDF (word for word, or with a very small difference), and on which page;
2. most of the item's key terms appear on the cited page.

Items that fail are removed, and a course with nothing left is rejected. The app shows how many items were kept and removed.

**This does not guarantee accuracy.** The checks are lexical. They catch invented quotes, wrong pages and off-topic claims, but a statement can reuse the right words and still be wrong, misleading or incomplete. Lessons are a study aid; students should confirm important points in their course material.

## Before deploying the backend

The backend is intentionally not deployed. Review these first:

- [ ] **Authentication.** There is none. CORS only restricts browsers; anyone can call the API directly. Add sign-in or signed requests.
- [ ] **Rate limits.** Per-address and daily caps are in memory and reset on restart. Use a shared store if there is more than one instance, and set `DAILY_GENERATION_CAP` to fit the free quota.
- [ ] **Origin allow-list.** Set `ALLOWED_ORIGINS` to the exact site origin (for Pages: `https://ehassan256417-afk.github.io`). Keep `ALLOW_NO_ORIGIN` off.
- [ ] **Data handling.** Student text is sent to the AI provider. ZRO's pricing page states zero request retention and no training on requests for every plan; read its privacy terms yourself and tell students before they upload.
- [ ] **Course material rights.** Students should only upload material they are allowed to use.
- [ ] **Logging.** The server logs method, path, status and timing only. Keep it that way on the host.
- [ ] **HTTPS and secrets.** Serve over HTTPS and store the key in the host's secret manager, not in the repo.
- [ ] **Spend limits.** Give the ZRO key a spend quota and an expiry date, and set `DAILY_GENERATION_CAP` to match.
- [ ] **Real-model test.** Run the pipeline against ZRO with a few real chapters and read the results critically.

After that, build the frontend with `NEXT_PUBLIC_LESSON_API_URL` set to the backend's URL.

## Known limits

- Scanned or image-only PDFs are not supported (no OCR).
- Limits: 25 MB, 60 pages, 150,000 characters; long documents are trimmed before generation.
- Lessons are per device; there are no accounts or sync.
- Demo courses and starting stats are sample content.
