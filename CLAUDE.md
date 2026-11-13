# UNA Learning: Claude Code guide

Mobile-first study app: course PDF -> short lessons, quizzes, flashcards. Next.js 15 / React 19 / TypeScript static frontend (GitHub Pages) plus a Node lesson backend in `server/` that is **not deployed**. See `README.md` for architecture, the lesson format and the pre-deploy checklist.

## Commands

```bash
npm ci
npm run dev      # frontend, http://localhost:3000
npm run server   # lesson backend, http://127.0.0.1:8787 (offline sample mode without a key)
npm test         # 109 tests, Node built-in runner
npm run lint     # tsc --noEmit
npm run build
```

Node 24+. The test files contain 105 `it(...)` calls; two of them sit inside `for (const key of SAMPLE_KEYS)` loops over the three sample PDFs (`tests/pdf.test.ts`, `tests/generate.test.ts`), so the runner reports 109. `node scripts/validate-provider.ts` makes real, billable API calls: never run it without the user's approval. Run `npm test` and `npm run lint` before calling any code change done.

## Guardrails

- A push to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). Work on a branch; never push to `main` or deploy the backend unless asked.
- Never commit `.env*` or `*.pdf`. No API key, provider URL or backend address in frontend code.
- The PDF file never leaves the browser; only `{ page, text }` goes to the backend.
- Grounding checks (`lib/learning/verify.ts`, `lib/learning/grounding.ts`) and request guards (`server/security.ts`) are the trust boundary. Changes there need tests first and a security review.
- Lesson generation is adaptive: `server/plan.ts` (one planning request, verified by fixed rules), `server/lesson.ts` (one request per lesson), `lib/learning/coverage.ts` and the browser driver `lib/learning/adaptive.ts`. Never add an automatic retry of an AI request, and keep every request inside the per-course budget (`server/budget.ts`).
- Phases 1 and 2 are done. Do not rebuild or restructure finished work. ZRO (`server/providers/zro.ts`) is the primary AI provider; Gemini is kept as an optional alternative. Open items: real ZRO run, auth, shared rate-limit store, backend hosting (README "Before deploying the backend").
- `.claude/` is git-ignored, so shared agent configuration lives in this file. Do not add project agents or change global settings; reuse what is installed.

## Model routing (default)

Pick the cheapest tier that can do the task well. Do small tasks inline; delegate only when the work is independent and would fill the main context (wide searches, parallel reviews, long test output).

| Tier | Use for | How |
| --- | --- | --- |
| **Strongest** (`fable` if the session offers it, else `opus`) | Architecture and design across module boundaries, backend auth / rate-limit / data-handling design, changes to the grounding algorithm, ambiguous requirements, anything stuck after two Sonnet attempts | `ecc:architect`, `ecc:planner` or `Plan`. These are read-only: they return a plan, the main session or a Sonnet agent implements it |
| **Sonnet** | Standard development: features, bug fixes, tests, refactors, code review, build errors | `general-purpose` with `model: "sonnet"`, or the specialist agents below (already pinned to Sonnet) |
| **Haiku** | Simple, low-risk work: locating files, running tests or lint and summarizing, doc and comment edits, copy tweaks | `Explore` with `model: "haiku"`, `ecc:doc-updater`, `ecc:comment-analyzer` (both pinned to Haiku) |

The `ecc:*` names come from the ECC plugin (v2.2.3) and the `anthropic-skills:*` names from the account's synced skills. If one is missing in a session, use the built-in `general-purpose`, `Explore` or `Plan` agent at the same tier. `ecc:docs-lookup` is left out on purpose: it needs a Context7 MCP server that is not connected here.

Rules:

- ECC agents carry their own model in frontmatter; pass `model` on the Agent call only to override (for example `ecc:architect` with `model: "fable"`).
- Escalate one tier when a result is wrong or incomplete; do not retry the same tier a third time.
- Never route `server/security.ts`, `server/schema.ts`, `lib/learning/verify.ts` or anything touching secrets to Haiku.
- Give each agent a self-contained brief: files, the question, what "done" looks like, and "read-only" when it must not edit.
- Multi-agent workflows (`Workflow` tool, `ecc:orch-*`, `ecc:multi-*`, `arena`) only when the user asks for them.
- Unsure which tier fits: `/ecc:model-route`.

## Agent by task

| Task | Agent |
| --- | --- |
| Find code, trace a flow | `Explore` (Haiku), `ecc:code-explorer` for deep traces |
| Design or plan a feature | `ecc:architect`, `ecc:planner` |
| Review `.ts` in `lib/`, `server/`, `tests/` | `ecc:typescript-reviewer` |
| Review `.tsx` in `app/`, `components/` | `ecc:react-reviewer` |
| Anything in `server/`, input validation, keys, CORS | `ecc:security-reviewer` |
| Swallowed errors, bad fallbacks in the pipeline | `ecc:silent-failure-hunter` |
| New behavior or bug fix | `ecc:tdd-guide` |
| `tsc` or `next build` fails | `ecc:build-error-resolver`, `ecc:react-build-resolver` |
| README or doc updates | `ecc:doc-updater` |
| Accessibility of screens | `ecc:a11y-architect` |

## Skill by task

Use an installed skill before improvising:

- Planning: `ecc:plan`, `anthropic-skills:writing-plans`
- Tests first: `ecc:tdd-workflow`, `anthropic-skills:test-driven-development`
- Debugging: `anthropic-skills:systematic-debugging`
- Review of a diff: `code-review` (low or medium effort), `ecc:react-review` for UI
- Backend and security: `security-review`, `security-audit`, `ecc:backend-patterns`, `ecc:api-design`
- Frontend: `ecc:react-patterns`, `ecc:frontend-patterns`, `ui-ux-design-review`, `ecc:accessibility`
- Before saying "done": `anthropic-skills:verification-before-completion`
- Finishing a branch: `anthropic-skills:finishing-a-development-branch`
