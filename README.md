# UNA Learning

Study platform that turns course PDFs and PowerPoint slides into short lessons, quizzes and flashcards, then brings them back for spaced review. Students have private accounts that follow them across devices, and the owner has a dashboard for visitors, students, AI usage and settings.

Independent student project for UNA students. **Not affiliated with or endorsed by the University of North Alabama.** The lion mascot is original artwork; no official university marks are used.

Live demo (static frontend): https://ehassan256417-afk.github.io/una-learning-app/

## What works

| Area | Status |
| --- | --- |
| Public landing page; nothing else is visible without signing in | Working |
| Accounts: register, sign in, sign out, change password, reset with a code from the owner, export and delete | Working locally (see "Accounts and the owner dashboard") |
| Courses and progress saved to the account and merged across devices | Working locally |
| Owner dashboard at `/owner`: traffic, funnel, students, AI usage, content, settings, invites, audit log, backups | Working locally, from real recorded events |
| Dashboard, learning path, pre-lesson, lesson, quiz, flashcards, progress, profile | Working. Hand-written example courses are labeled "Sample" and can be switched off |
| PDF upload with validation (type, size, file signature, page limit, scanned-PDF detection) | Working in the browser |
| PDF text extraction with page numbers | Working in the browser; the file never leaves the device |
| PowerPoint (.pptx) extraction: slide text, tables, speaker notes, slide numbers | Working in the browser; the file never leaves the device |
| Pictures from slides shown beside the notes that cite the slide | Working. Stored on the device only; no model looks at them |
| Mastery loop, flashcard self-rating, spaced review, weak-concept tracking | Working, saved to the account |
| Lesson backend (`server/`) with provider abstraction | Working locally |
| Offline sample provider (no AI, no key) | Working, used by tests and local development |
| ZRO provider (primary, `deepseek-v4.1-flash`) | Implemented from the ZRO API reference and unit-tested against a mocked API. **Not yet run against the real API** (needs a key) |
| Gemini provider (optional) | Kept as an alternative. Run against the real API on 2026-11-13: the default model `gemini-2.5-flash` is retired for new keys, newer models often returned HTTP 503, and the 8,192 output-token cap cut lessons off. Not recommended without changes |
| Grounding check of generated content against the PDF | Working |
| Saved lessons (no repeated AI requests) | Working: browser storage plus a short-lived backend cache |
| Hosted backend | **Not deployed.** Until it is, the live site runs in device-only mode: no accounts, data stays in the browser, and Upload shows "not connected" |

## Run it

Requires Node 24 or newer.

```bash
npm install
npm run dev        # frontend at http://localhost:3000
npm run server     # lesson backend at http://127.0.0.1:8787 (second terminal)
```

Without a key the backend runs in **offline sample mode**: it builds lessons by copying sentences from the PDF and blanking out words. That exercises the whole flow but is not AI.

To use real AI, copy `server/.env.example` to `.env` in the project root and set `ZRO_API_KEY` (create it at https://zro.moonmath.ai under Account, API keys; give the key a spend quota and an expiry date). `.env` is git-ignored. Optional settings: `ZRO_MODEL`, `ZRO_REASONING_EFFORT` (`none`, `low`, `high`, `max`; default `none`) and `ZRO_MAX_TOKENS` (default 32000). Reasoning tokens count against `ZRO_MAX_TOKENS`: with `low` and 16000, a 7-page PDF used the whole allowance on reasoning and returned no lesson. ZRO bills by usage: its pricing page lists free daily usage on `deepseek-v4.1-flash`, and anything beyond that draws on a plan or usage pack.

`node scripts/validate-provider.ts zro biology` runs the pipeline against the live provider with a synthetic sample PDF and writes a report (timing, token usage, kept and dropped items) to the git-ignored `.claude/validation/`. It makes real API calls, so run it on purpose.

## Accounts and the owner dashboard

`npm run server` now also runs the platform: accounts, each student's saved courses and progress, measured activity, the AI request log, settings and an audit log. It is stored in one SQLite file, `data/una.db` (Node's built-in `node:sqlite`, no extra dependency). `data/` is git-ignored: it holds real students' data, so back it up and never commit it.

**Create the owner account once.** Put your email and a long random code in `.env`:

```
OWNER_EMAIL=you@example.com
OWNER_SETUP_CODE=a-long-random-string
```

Restart the server, open the site, choose "Create account", then "I have an invite code", and enter that email with the setup code. That account is the owner; the role cannot be given any other way, and nobody can claim your email without the code. The dashboard is at `/owner` (also linked from your profile). To everyone else that address shows "Page not found".

**How it fits together**

- A session is a random token sent in the `Authorization` header. The database stores only its SHA-256. Passwords are stored as salted scrypt hashes. Cookies are not used, because the site and the backend are on different domains and browsers block cross-site cookies.
- `/api/me/*` reads and writes only the signed-in account's rows; the account id comes from the session, never from the request. `/api/admin/*` needs the owner role.
- Courses and progress are cached in the browser under a per-account key and saved to the account. A second device downloads them at sign-in. When two devices change progress, the copies are merged (`lib/account/merge.ts`): finished lessons and review records from both are kept and XP takes the larger total. Signing out uploads pending changes, then removes the account's data from that browser.
- Work done in a browser before registering there (the device-only mode) moves into the new account at registration.
- **The uploaded PDF or PowerPoint file is still never sent anywhere.** The account holds the generated course (lessons, citations, plan), not the original file. Slide pictures stay in the browser that read the file, so they do not appear on a second device.
- Limits that protect the server: wrong passwords are counted per account and address (8 in 15 minutes) and correct sign-ins never count; an account keeps at most ten devices signed in; one account can store 30 MB of courses; activity reports are capped per browser and per day, and activity older than 400 days is deleted; the dashboard keeps the 14 newest backups.
- AI requests need a signed-in student and count against that student's daily limit, the platform's daily limit and the per-course budget. All three are set in the dashboard. The counts come from the request log in the database, so they survive a restart.
- There is no email service. A student who forgets their password asks the owner, who creates a one-time reset code in the dashboard (valid for one hour) for the student to enter at `/reset`. Email addresses are not verified.

**What is measured, and how honest the numbers are**

| Number | How it is counted |
| --- | --- |
| Visits, page views, moves between pages, exits | Recorded events. Only the kind of page is stored (for example `/my/lesson`); course ids and query strings are never sent |
| Unique visitors, returning visitors | A random id kept in the browser. **An estimate**: one person on two devices counts twice, and clearing browser data starts a new id |
| Active time | Seconds with the tab visible and keyboard, pointer, touch or scroll input in the last minute. An open tab nobody touches adds nothing. The server never credits more time than passed since the previous report |
| Study time | The part of active time spent in a lesson or a review session |
| Sign-ups, sign-ins, AI requests, tokens, failures | Recorded by the server itself |
| Token counts | From the provider when it reports them; otherwise estimated and marked so |
| Cost | **An estimate**: tokens multiplied by the prices you enter in Settings. Empty until you enter prices |

Not measured: visitors who are not signed in and whose browser sends Do Not Track or Global Privacy Control, and the owner's own use of the app. Days are UTC. No IP addresses, names or document text are stored in the activity tables, and there are no third-party analytics.

**What the owner can and cannot see.** The owner sees each student's email, name, activity, learning numbers, AI usage and the titles and file names of their courses. The dashboard does not show lesson text. Opening one student's record, and every change (suspend, beta flag, reset code, sign out, delete, take a course offline, settings, invites, backups), is written to the audit log.

**Settings the owner can change without touching code:** who may register (open, invite only, closed) and invite codes; AI limits per student, per day and per course; the model name and prices; feature switches (lesson generation, PowerPoint upload, spaced review, sample courses); a site-wide announcement; the tagline and support email on the landing page; review session size and the daily XP goal.

```bash
npm test           # 257 tests, Node's built-in runner
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
- **Lessons are cached on the student's device** (`localStorage`) and, when signed in, saved to their account in the backend's database. The lesson cache keeps results in memory for up to 24 hours, keyed by a hash of the text.
- **Extracted text is not stored.** It is sent to the backend for a lesson request, passed to the AI provider and dropped; only the generated lessons (with their short quotes) are saved.

```
app/                 routes; /my opens PDF courses from browser storage
components/          screens and shared UI
lib/pdf/             validation and page-level text extraction
lib/pptx/            .pptx validation and slide-level extraction (text, tables, notes, pictures)
lib/source/          one entry point that reads either file type in the browser
lib/progress/        XP, streak, unlocking, and mastery / spaced review (`mastery.ts`)
lib/learning/        types, API contracts, grounding verification, browser store
lib/account/         session, API client, progress merge, course sync, activity tracker, shared contracts
components/owner/    the owner dashboard
server/              HTTP API, generation pipeline, providers, request guards
server/db.ts         SQLite schema; accounts.ts (passwords, sessions, invites);
                     platform.ts (saved data, activity, AI log, dashboard queries); routes.ts (endpoints)
tests/               unit and end-to-end tests with sample PDFs (biology, history, computing)
```

## PowerPoint slides

A `.pptx` is read on the device by `lib/pptx/extract.ts`. Slide N becomes "page" N, so the same plan, lesson and grounding pipeline runs unchanged and citations read "Slide 4". Per slide it keeps the title and body text, tables (cells joined with ` | `, rows with `; `), text in grouped shapes, and speaker notes (prefixed "Speaker notes:"). Footers, dates and slide numbers are dropped.

Pictures placed on a slide (PNG, JPEG, GIF, WebP; checked by file signature) are saved in the browser's IndexedDB and shown under the lesson notes that cite that slide, with a caption saying the explanation was written from the slide's text. **The pictures are not sent to the lesson service and no model interprets them.**

The file is untrusted input. The reader inflates only the parts it needs, refuses declared sizes over 5 MB per XML part, 3 MB per picture or 80 MB in total, archives with more than 5,000 entries or duplicate entry names, and parts with unclosed tags; relationship targets that are external or leave the archive are ignored.

Not read: charts, SmartArt stored in separate parts, EMF/WMF/SVG pictures, pictures used as a shape fill, old `.ppt` files (the app asks for `.pptx`). A deck that is mostly pictures is rejected as having too little text.

## Mastery and spaced review

`lib/progress/mastery.ts` holds the rules; they are pure functions with their own tests.

- **In a lesson**, a missed question comes back at the end of the quiz until it is answered correctly, so a lesson cannot be finished with a mistake left uncorrected. The score and XP count first attempts only.
- **Flashcards** are self-rated Again / Good / Easy after flipping.
- **After a lesson**, every question and card gets a review record (Leitner boxes, gaps of 1, 3, 7, 16, 35 and 75 days). A miss sends the item back to the start and makes it due the same day. Practising an item before it is due cannot move it up.
- **`/review`** runs a short session (up to 15 items, missed items first) across all courses. Home and Progress show how many items are due.
- **Progress** groups questions by planned concept and shows weak, learning and strong counts, with links to the lessons behind weak concepts.

Records are stored with the rest of the progress in `localStorage`; progress saved before this feature loads unchanged.

## Adaptive lesson generation

Lessons follow the concepts in the PDF, not its page count and not a fixed number.

1. **Plan** (`POST /api/lessons/plan`, one AI request). The model reads the whole text with page markers and proposes concepts (name, summary, difficulty, core or supporting, pages, prerequisites, evidence quotes) and lessons. `server/plan.ts` then applies fixed rules: a concept is kept only if its quotes are found in the PDF; unknown or circular prerequisites are removed; a small supporting detail (one prerequisite, explained on that concept's own pages) is folded into its concept and taught inside that lesson, up to 3 per concept; a lesson with more than 4 concepts is split, with each objective kept by the part that teaches it; concepts the model forgot are grouped by difficulty; lessons are ordered so prerequisites come first. Anything left out is recorded with a reason.
2. **Lessons** (`POST /api/lessons/lesson`, one AI request per planned lesson). Each request carries only the pages that lesson's concepts cite, and a small output cap. Notes are labelled what / why / how / example; an example is shown only if it appears on a cited page; questions whose prompt already contains the answer are removed. The quote, page and key-term checks and the answer shuffling are the same as before.
3. **Coverage** (`lib/learning/coverage.ts`). After every lesson the app works out which planned concepts have both an explanation and a practice question, which pages are cited, and lists what was left out. This compares the plan with the lessons; it cannot tell whether the plan itself missed something.

The browser runs the loop (`lib/learning/adaptive.ts`) and saves the course after every lesson, so a failure keeps the lessons already made. Nothing is retried automatically: a failed lesson waits until the student chooses "Generate the remaining lessons", because each retry is a new AI request.

**Requests per PDF:** 1 plan + 1 per lesson. **Cost controls** (set in `.env`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `COURSE_MAX_REQUESTS` | 12 | AI requests for one course. The plan may use up to this minus 2 lessons (one request is the plan, one is spare for a retry) |
| `COURSE_MAX_TOKENS` | 120000 | Prompt plus output tokens for one course. A request is refused before it is sent if its worst case does not fit |
| `PLAN_MAX_TOKENS` | 8000 | Output cap of the planning request |
| `LESSON_MAX_TOKENS` | 6000 | Output cap of one lesson request |

These `.env` values are only the starting point: once the owner saves settings in the dashboard, the dashboard values apply. Plans and lessons are cached in memory for 24 hours, and the daily caps still apply. The per-course budget is tied to the signed-in student. Its counters are in memory, so a restart resets a course's budget (the daily limits are in the database and do not reset). A failed request that reports no usage is counted as a request but as 0 tokens.

**When the AI provider is down.** A 5xx answer from the provider (for example ZRO returning HTTP 503 "Request failed.") means it did no work and the document is not the cause. The backend answers `503 provider_unavailable` with a `Retry-After` header, gives the course its request back, and pauses that provider and model: 30 seconds, then 60, 120 and 300 if the outage repeats (a longer `Retry-After` from the provider is followed, up to 15 minutes). Requests during the pause are refused without calling the provider and are not counted against any limit. Nothing is sent again on its own: the next attempt is the student's, and the first success clears the pause. The attempt that met the outage stays in the AI log (`provider_unavailable`, with the upstream status) and in the daily count. `GET /api/health` shows `providerRetryAfterSec` while a pause is active, and the server log has a `provider <id> unavailable` line. The pause is in memory, so a restart clears it.

The older single-request endpoint (`POST /api/lessons/generate`) still exists for the validation script; the app no longer uses it.

`node scripts/validate-adaptive.ts biology` runs the adaptive flow against the live provider with a synthetic sample PDF and a hard request limit (`VALIDATE_MAX_CALLS`, default 4). It makes real API calls, so run it on purpose. A run on 2026-11-13 used 4 requests, 61 seconds and about 11,400 tokens for a plan and three lessons.

## Lesson format

This describes the older single-request format; adaptive lessons use the plan and lesson formats in `server/plan.ts` and `server/lesson.ts`, with the same citation rule. The provider must return JSON with three sections (Beginner, Intermediate, Advanced). Each has objectives, key points, notes, three questions (difficulty 1 to 3) and flashcards. Every note, key point, question and flashcard carries citations:

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

- [x] **Authentication.** AI requests need a signed-in student. Set `OWNER_EMAIL` and `OWNER_SETUP_CODE`, and consider starting with `REGISTRATION_MODE=invite` so only people you invite can register and use your AI quota.
- [ ] **Hosting.** The backend needs a host that runs Node 24 and keeps a disk (the SQLite file). One instance only: sign-in rate limits, course budgets and the lesson cache are in memory, and SQLite is a single file. That is enough for a beta of tens of students; a larger launch needs a shared database and rate-limit store.
- [ ] **Backups.** Everything students have is in `DATA_DIR`. "Back up now" in the dashboard writes a copy to `DATA_DIR/backups` on the same disk; copy those files somewhere else on a schedule.
- [ ] **Reverse proxy.** Behind a proxy, set `TRUST_PROXY=true` so sign-in limits apply to the visitor's address and not the proxy's. Do not set it otherwise.
- [ ] **Privacy notice.** Accounts mean you hold personal data (emails, study activity). Publish a short privacy note saying what is stored and measured (see the table above), and that students can export and delete their account from their profile.
- [ ] **Email.** Addresses are not verified and password reset goes through you. Add an email service before opening registration widely.
- [ ] **Origin allow-list.** Set `ALLOWED_ORIGINS` to the exact site origin (for Pages: `https://ehassan256417-afk.github.io`). Keep `ALLOW_NO_ORIGIN` off.
- [ ] **Data handling.** Student text is sent to the AI provider. ZRO's pricing page states zero request retention and no training on requests for every plan; read its privacy terms yourself and tell students before they upload.
- [ ] **Course material rights.** Students should only upload material they are allowed to use.
- [ ] **Logging.** The server logs method, path, status and timing only. Keep it that way on the host.
- [ ] **HTTPS and secrets.** Serve over HTTPS and store the key in the host's secret manager, not in the repo.
- [ ] **Spend limits.** Give the ZRO key a spend quota and an expiry date, and set `DAILY_GENERATION_CAP` to match.
- [ ] **Real-model test.** Run the pipeline against ZRO with a few real chapters and read the results critically.

After that, build the frontend with `NEXT_PUBLIC_LESSON_API_URL` set to the backend's URL.

## Known limits

- Scanned or image-only PDFs and picture-only slide decks are not supported (no OCR).
- Diagrams and pictures are shown from slides but not understood: lessons are written from text only. Pictures inside PDFs are not extracted yet.
- Server messages and the stored coverage notes still say "page" and "PDF" for slide courses.
- Limits: 25 MB, 60 pages, 150,000 characters; long documents are trimmed before generation.
- Original files and slide pictures are not stored in the account, so pictures show only on the device that read the file.
- A browser caches at most about 5 MB of courses. Beyond that the oldest are dropped from that device (they stay in the account).
- XP earned on two devices while both are offline is not added twice after merging, and may undercount slightly.
- No email verification or self-service password reset; no two-factor sign-in.
- The owner dashboard has one owner. There are no instructor or assistant roles yet.
