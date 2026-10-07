# PrepRoom

Live, face-to-face AI video interview practice for **investment banking**, **venture capital / private equity** and **consulting**, with an honest score and evidence-based feedback at the end.

The interviewer is a [Tavus](https://docs.tavus.io) Conversational Video Interface PAL (Tavus's renamed "persona"). Each firm gets its own PAL, configured from four plain-text files. After the call, Claude (`claude-sonnet-5-5`) scores the transcript against a firm-specific rubric.

> PrepRoom is an independent practice tool and is not affiliated with or endorsed by any listed firm.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the keys
npm run dev                    # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `TAVUS_API_KEY` | yes | Tavus API key (server-side only). |
| `ANTHROPIC_API_KEY` | no | Enables the written post-interview scorecard. Without it, interviews end on a completion screen and the interviewer's spoken debrief is the feedback. |
| `TAVUS_DEFAULT_REPLICA_ID` | no | A Tavus **face id** (formerly replica). If unset, the best stock face is auto-selected and cached. |
| `APP_BASE_URL` | no | Public URL of the app. When it's a public `https://` URL, Tavus webhooks and knowledge-base documents are enabled. On localhost the app falls back to polling. |
| `TAVUS_WEBHOOK_SECRET` | no | Shared secret appended to the callback URL and verified by `/api/webhooks/tavus`. |

**Firms available (9):**

| Industry | Firm · team | Interviewer |
|---|---|---|
| Consulting | AlixPartners · Turnaround & Restructuring | Markus Lehner |
| Consulting | Simon-Kucher · Pricing | Katharina Brandt |
| Consulting | Bain & Company · PE / Commercial Due Diligence | Jonas Weber |
| Investment Banking | Goldman Sachs · TMT | Alexander Kessler |
| Investment Banking | Citi · Power, Utilities & Infrastructure | Sophie Lambert |
| Investment Banking | Houlihan Lokey · Industrials | Maximilian Roth |
| VC / PE | General Atlantic · Growth Equity | Lukas Brenner |
| VC / PE | Verdane · Growth Investing | Hannah Krüger |
| VC / PE | HV Capital · Venture Capital | Clara Neumann |

All interviewers are fictional, give a spoken debrief at the end, understand "timeout", "hard mode", "auf Deutsch" etc., and are followed by a written 1–10 scorecard.

## Adding a company

```bash
npm run scaffold -- --industry consulting --company "Oliver Wyman" --style "Case + Fit" --tagline "Specialist strategy with deep industry practices." [--featured]
```

This:

1. creates `interviews/consulting/oliver-wyman/` with `systemprompt.txt`, `capabilities.txt`, `guardrails.txt`, `objectives.txt` and a `knowledge/` folder, generated from `interviews/_templates/consulting/` with the firm name and style filled in;
2. adds the firm to `src/data/catalog.ts` (at the `@scaffold-insert` marker);
3. validates the result.

Industries: `investment-banking`, `venture-capital`, `consulting`. Up to 4 firms per industry with `featured: true` appear in the large top row. All others go in the "All firms" grid.

Then **edit the four files** to make the interviewer firm-specific, and run:

```bash
npm run validate:interviews        # also runs automatically before `npm run build`
npm run provision -- --company oliver-wyman --verify   # optional pre-warm + check against the Tavus API
```

## Editing interview files

Each firm folder contains:

| File | What it is | Becomes in Tavus |
|---|---|---|
| `systemprompt.txt` | Interviewer identity, firm culture, structure and timing, how to speak on video, closing behavior. Featured firms must be 400–900 words. | PAL `system_prompt` |
| `capabilities.txt` | Concrete behaviors: follow-ups, challenges, technicals/cases with numbers, time management, perception cues, recovery. | Appended to the system prompt as `## Capabilities` |
| `guardrails.txt` | Hard boundaries, as blocks (below). | One Tavus guardrail per block, attached via `guardrail_ids` |
| `objectives.txt` | 5–7 ordered interview stages with completion criteria, as blocks. | One Tavus objectives set (`objectives_id`) |
| `knowledge/*.md` / `*.txt` | Optional reference material (cases, answer keys, rubric). `README.*` files are ignored. | Inlined into the system prompt (up to ~48k chars total); larger knowledge becomes Tavus documents when `APP_BASE_URL` is public |
| `settings.json` | Optional per-firm settings (below). | Greeting, call length, languages, perception queries |

**Block format** (`guardrails.txt`, `objectives.txt`): `---` separates blocks, `#` starts a comment, and `key: |` starts an indented multi-line value.

```text
name: stay_in_role
prompt: |
  Always remain the interviewer from {{company_name}}...
---
name: walk_through_resume
prompt: |
  Ask the candidate to walk through their resume...
confirmation_mode: auto        # objectives only: auto | manual
next: motivation_for_firm_and_role
```

* Guardrail keys: `name` (letters/digits/underscores, ≤100), `prompt` (≤1000 chars), optional `modality` (`verbal` | `visual`).
* Objective keys: `name`, `prompt`, optional `confirmation_mode`, `next`, `modality`, `output_variables` (comma-separated), or `branches` for conditional next steps:

  ```text
  branches: |
    end_early: Only when the candidate explicitly asks to stop, end, or leave.
    deliver_debrief: Only when the interview portion is complete.
  ```
* Placeholders in any file: `{{company_name}}`, `{{level}}`, `{{focus}}`, `{{candidate_name}}`, filled per session (see DECISIONS.md §2).
* Parse errors name the file and line, e.g. `interviews/consulting/bain/objectives.txt:14: unknown key "colour" in objective #3`.

**`settings.json`** (optional; all keys optional):

```json
{
  "greeting": "Hi, I'm Markus Lehner from … what should I call you?",
  "greetingWithName": "Hi {{candidate_name}}, I'm Markus Lehner from …",
  "interviewMinutes": 35,
  "maxCallMinutes": 45,
  "inCallDebrief": true,
  "languages": ["en", "de"],
  "focusCommands": { "Technical": "case only", "Behavioral": "fit only" },
  "perceptionQueries": ["Is the candidate looking at the camera or reading from notes?"],
  "cvUpload": true
}
```

Preview exactly what would be sent to Tavus, without calling it: `npm run provision -- --company bain-cdd --dry-run`.

Edits take effect automatically. The next interview start detects the content-hash change and re-provisions (patching the same PAL).

## How it works

```
Welcome → /industry/[industry] → /interview/[industry]/[company]
   pre-flight modal (privacy notice, camera/mic check, level + focus, optional CV → POST /api/cv)
   → POST /api/interview/start   provision-or-reuse PAL, create Tavus conversation
   → full-screen Daily call (call-object mode) with PrepRoom's own controls and captions
   → POST /api/interview/end     (button, countdown, interviewer leaving, or tab close via sendBeacon)
   → /results/[id]               polls GET /api/interview/[id]/result until scored
```

* **Transcripts** come from the `application.transcription_ready` event, via webhook when public or by polling `GET /v2/conversations/{id}?verbose=true` for up to 90 s.
* **Scoring** rejects transcripts with fewer than 3 substantive answers (no score is ever invented), verifies every quoted line against the candidate's actual words (retrying once, then dropping quotes it can't verify), and only mentions visual cues if Tavus perception analysis exists.
* **Storage**: `data/results/{conversationId}.json` and `data/tavus-cache.json` (gitignored), behind the `ResultStore` / `ProvisionCacheStore` interfaces in `src/lib/storage.ts`, ready to swap for Postgres.

## Scripts

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (build runs `validate:interviews` first) |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests (Vitest): parser, hash cache, scoring schema, Tavus retry logic |
| `npm run test:e2e` | Playwright smoke test (Welcome → Industry → Company → Pre-flight → Start), with Tavus mocked |
| `npm run validate:interviews` | Validate templates and every catalog firm's files |
| `npm run scaffold -- …` | Add a firm from its industry template |
| `npm run provision -- --company <slug> [--verify]` / `provision:all` | Pre-warm Tavus resources and verify them against the API |
| `npm run check:secrets` | After a build, grep the client bundle for API keys and server-only markers |

## Project layout

```
src/app/                     pages + API routes (start, end, result, webhooks/tavus, knowledge)
src/components/              UI (IndustryCard, CompanyCard, PreflightModal, InterviewStage, ControlBar, ScoreDial, …)
src/data/catalog.ts          industries + firms
src/lib/                     tavus.ts, provision.ts, interviewLoader.ts, scoring.ts, finalize.ts, storage.ts, schemas.ts
interviews/_templates/       per-industry templates used by the scaffold
interviews/{industry}/{slug}/  per-firm interview files
scripts/                     scaffold, provision, validate-interviews, check-bundle-secrets
tests/                       unit, e2e, fixtures (a fictional firm used only by tests)
```

See **DECISIONS.md** for every API mapping and judgment call.
