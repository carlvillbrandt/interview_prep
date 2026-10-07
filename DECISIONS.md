# PrepRoom — Design Decisions

Every ambiguity in the build brief, and every place where the live Tavus API
(`https://docs.tavus.io/openapi.yaml`, read in full on 2026-10-06) differs from the
brief's vocabulary, is recorded here.

## 1. Tavus API: what the spec actually says

| Brief says | Spec reality (2026-10) | What PrepRoom does |
|---|---|---|
| Personas (`/v2/personas`, `persona_id`) | Renamed to **PALs**: `POST/GET /v2/pals`, `GET/PATCH/DELETE /v2/pals/{pal_id}`, field `pal_id` | Uses `/v2/pals`. Internally the cache still calls it the "persona" slot but stores `palId`. |
| Replicas (`/v2/replicas`, `replica_id`) | Renamed to **Faces**: `GET /v2/faces` (`/v2/replicas` is a legacy alias). PAL field is `default_face_id`. | Uses `/v2/faces?face_type=system&verbose=true` to auto-select a stock face. `TAVUS_DEFAULT_REPLICA_ID` is still honoured (a face id). |
| `guardrails_id` (one guardrail set) | `guardrails_id` is **deprecated**. Guardrails are now individual resources (`POST /v2/guardrails` → `uuid`) attached with `guardrail_ids: string[]` (max 50). `guardrail_name` must be `[A-Za-z0-9_]`, ≤100 chars; `guardrail_prompt` ≤1000 chars. | Each block in `guardrails.txt` becomes one guardrail; the PAL gets `guardrail_ids`. The loader enforces both limits at validate time, so a bad file fails `npm run validate:interviews` rather than the live API. |
| Objectives | `POST /v2/objectives` with `{ data: [{ objective_name, objective_prompt, confirmation_mode, next_required_objective, ... }] }` → one `objectives_id` | `objectives.txt` keys map as `name→objective_name`, `prompt→objective_prompt`, `next→next_required_objective`, `confirmation_mode` passes through. |
| Documents upload | `POST /v2/documents` accepts only a **`document_url`** (pdf/txt/docx/…; no `.md`, no multipart upload). Processing is async (minutes). | `knowledge/*.md` is served as `text/plain` from `GET /api/knowledge/{industry}/{company}/{file}.txt` and registered **only when `APP_BASE_URL` is public HTTPS**. On localhost the knowledge step is skipped with a log line. Documents are attached once `ready` (polled up to 60 s), otherwise skipped for that provisioning run. |
| Conversation transcript | `GET /v2/conversations/{id}?verbose=true` → `events[]`; the `application.transcription_ready` event carries `properties.transcript[]` (`role`, `content`, …). Perception: `application.perception_analysis` / `application.perception_unavailable`. | Polling fallback reads exactly these events. Webhook handler accepts the same event shapes. |
| "Griffin" model / pipeline | **Not present anywhere in the spec** (0 matches). | Standard CVI flow. Pipeline: `pipeline_mode: full`, LLM `tavus-gemma-4` (spec's recommended default) with speculative inference, STT `tavus-auto` + firm-name hotwords, turn-taking `sparrow-2`, perception `raven-1`, TTS `tavus-auto`. |
| Webhook signatures | No signing scheme for conversation `callback_url` (HMAC exists only for *tools*). | If `TAVUS_WEBHOOK_SECRET` is set, it is appended as `?token=` to the callback URL and checked in constant time by `/api/webhooks/tavus`. |
| Auth | `x-api-key` header, base URL `https://tavusapi.com` | As specified. |
| Concurrency / credits | 400 with `message: "User has reached maximum concurrent conversations"`; credit exhaustion is not documented with a fixed shape. | Errors are classified by status + message (`concurrency_limit`, `credits_exhausted` on 402 or a "credit"/"balance"/"quota" message, `rate_limited`, `unauthorized`, …) and mapped to friendly UI copy. |
| PAL patch | JSON Patch (RFC 6902) array; `409` if the PAL has PAL-Maker drafts | Re-provisioning uses `replace` ops; on `409` it retries with `?force=true`; on `404` it creates a fresh PAL. |

## 2. Content placeholders

`{{level}}`, `{{focus}}`, `{{candidate_name}}`, `{{company_name}}` are supported in all four files.
A PAL is **shared across conversations**, so per-session values can't be baked into its system prompt:

* `{{company_name}}` is filled at provisioning time.
* `{{level}}`, `{{focus}}`, `{{candidate_name}}` are rewritten to the tokens `LEVEL`, `FOCUS`, `CANDIDATE_NAME`
  and a short "Runtime variables" preamble tells the LLM their real values are in the
  **Session details** block of `conversational_context`, which is rendered per conversation
  (with the actual values and level/focus-specific difficulty guidance). The preamble also tells it never to say the tokens aloud.
* Objective and guardrail prompts get the same treatment.

## 3. Provisioning and caching

* Content hash = SHA-256 over: the four files, every knowledge file (name + content), the resolved
  face id, and `PROVISION_VERSION` (bumped when the layer config in code changes). Any edit re-provisions.
* On a hash change: new objectives + guardrails are created and the existing PAL is **patched**
  (same `pal_id`). Superseded objectives/guardrails are not deleted. That is deliberate: a conversation
  already in progress may still reference them. They are cheap and can be cleaned up in the Tavus dashboard.
* Concurrent `start` calls for the same company share a single in-flight provisioning promise.
* Cache lives in `data/tavus-cache.json` behind `ProvisionCacheStore`; results in
  `data/results/{conversationId}.json` behind `ResultStore` (`src/lib/storage.ts`). Swap the
  file implementations for Postgres without touching callers.

## 4. Conversation settings

* `max_call_duration` 1200 s (20 min); UI shows a countdown for the last 120 s and ends the call at 0.
* `participant_left_timeout` 10 s (stop billing quickly after the candidate leaves), `participant_absent_timeout` 120 s.
* `enable_closed_captions: true`; captions are rendered by PrepRoom itself from `conversation.utterance` app-messages, so the toggle works in our own UI.
* `enable_recording: false`. Recording needs customer-owned S3/GCS/Azure storage per the spec, and the privacy
  notice promises transcripts only.
* `languages: ["en"]` (the non-deprecated replacement for `language: "english"`).
* `callback_url` is set only when `APP_BASE_URL` is publicly reachable (https and not localhost/private).
* `custom_greeting` is generated from the interviewer name parsed from `systemprompt.txt` ("You are <Name>, …").

## 5. Embedding the call

`conversation_url` is a Daily room (`https://tavus.daily.co/...`). PrepRoom uses **`@daily-co/daily-js` in call-object mode**
rather than an iframe: we render the interviewer's video ourselves, which gives full control over the
immersive layout, our own control bar (mute / camera / captions / timer / end), reliable detection of the
interviewer leaving, and access to `app-message` events for captions.

## 6. Ending, scoring, reliability

* End triggers: user button, countdown reaching 0, the interviewer participant leaving, tab close
  (`navigator.sendBeacon` → `/api/interview/end`).
* `/api/interview/end` ends the Tavus conversation, marks the result `processing`, and starts finalisation in
  `after()`. Finalisation is idempotent and single-flight per conversation. The result route re-kicks it if a
  server restart orphaned a `processing` record, so the webhook, the polling fallback and the results page can never double-score.
* Polling fallback: `GET /v2/conversations/{id}?verbose=true` with backoff (1.5 s → ×1.5, cap 8 s) for up to 90 s.
* Tavus client retries: 429 always (honours `Retry-After`); 5xx and network errors only for idempotent
  methods (GET/DELETE/PATCH) plus POST 502/503/504 (not processed). A POST that got a 500 may have succeeded, so it is never retried, to avoid
  creating duplicate conversations that burn minutes. 15 s timeout per attempt.
* Rate limit: 5 interview starts per IP per 10 minutes (in-memory; replace with Redis behind a proxy farm).

## 7. Scoring engine

* Model: `claude-sonnet-5-5` (the newest Sonnet available; the brief asked for "claude-sonnet-4-6 or the newest Sonnet").
  Called with structured outputs (`betaZodOutputFormat`), `effort: "medium"` to keep end-to-end latency
  inside the 90 s budget, and the server-side refusal fallback (`fallbacks: "default"`) so a
  classifier false-positive on an interview transcript doesn't strand the user without feedback.
* **Insufficient data** is decided deterministically *before* calling Claude: fewer than 3 candidate turns of ≥ 6 words.
  No score is ever produced in that case.
* Quotes are verified against the candidate's turns after normalising case, punctuation and whitespace. If any quote fails,
  Claude is asked once more with the failing quotes listed. Moments that still don't verify are **dropped**, never shown.
* `hire_signal` is derived from `overall_score` with fixed bands (<4 Strong No Hire, <5.5 No Hire, <7 Lean Hire,
  <8.5 Hire, else Strong Hire), so the label can never contradict the number.
* Category scores are integers 1–10; overall is 1.0–10.0 with one decimal. Calibration guidance (strong mock = 7–8) is in the prompt.
* Perception: included only when an `application.perception_analysis` event exists. Otherwise the result is flagged
  `perceptionAvailable: false`, the prompt forbids visual claims, and the UI states "Feedback is based on spoken content only."
* Firm rubric = industry rubric (in code) + the firm's `objectives.txt` + its interview style from the catalog.

## 8. Catalog and content (per the user's revised brief)

* The catalog started empty; firm content is supplied by the user. All nine supplied firms are live, mapped as described in §11:
  Consulting (AlixPartners, Simon-Kucher, Bain & Company), Investment Banking (Goldman Sachs TMT, Citi Power/Utilities/Infra,
  Houlihan Lokey Industrials), VC/PE (General Atlantic, Verdane, HV Capital).
* Industry **templates** in `interviews/_templates/{industry}/` *are* authored (generic, firm-agnostic), because the scaffold
  script needs them and they double as format references. `npm run scaffold` fills `{{company_name}}` and
  `{{interview_style}}`, and inserts a catalog entry at the `@scaffold-insert` marker.
* `validate:interviews` validates the templates plus every catalog company. With an empty catalog it passes on
  templates alone. It runs automatically before `npm run build`.
* Rules enforced for every company: 4 files present, ≥1 guardrail, 2–10 objectives, every `next`/branch target exists,
  Tavus length limits, valid `settings.json`. The original "5–7 objectives" and "400–900 words" rules were relaxed because the
  supplied firm content (4 objectives, ~1,900-word prompts) is authoritative; a prompt under 150 words is still an error.

## 9. Testing without real firms

The Playwright smoke test needs a clickable company. When `NEXT_PUBLIC_E2E_FIXTURES=1` the catalog adds one fixture
firm and the loader reads from `tests/fixtures/interviews`. This flag is set only by `playwright.config.ts`.
Production builds never include it.

## 10b. Testing note

The Playwright server sets `INTERVIEWS_FALLBACK_DIR=tests/fixtures/interviews`: real firms load from `/interviews`,
and only folders missing there (the fixture firm) come from the fixtures directory.

## 10. Framework

* Next.js **16.4** (the brief says "14+"; latest stable on the build date), React 19, Tailwind v4, Turbopack, Cache Components enabled.
  Pages that read params wrap the dynamic part in `<Suspense>` with skeleton fallbacks, which is the Cache Components model.
  With an empty catalog, `generateStaticParams` would return `[]`, which Cache Components rejects, so company routes render on demand.
* `next lint` no longer exists in v16; `npm run lint` runs the ESLint CLI.
* Zod v4 for all payloads (the Anthropic SDK's zod helper targets `zod/v4`).

## 11. Supplied firm content (October 2026)

Each supplied persona came as `SystemPrompt.md`, `KnowledgeBase.txt` and `SetupFields.md`. Mapping:

| Supplied | PrepRoom file | Notes |
|---|---|---|
| SystemPrompt.md | `systemprompt.txt` | Verbatim. |
| KnowledgeBase.txt | `knowledge/<name>.txt` | Verbatim. **Inlined into the PAL system prompt** (see below). |
| SetupFields §1 greeting | `settings.json` → `greeting` | Plus `greetingWithName` for when the candidate typed a name in setup. |
| SetupFields §2 capabilities | `capabilities.txt` + `settings.json` → `perceptionQueries` | Perception queries become Raven `visual_awareness_queries`. |
| SetupFields §4 objectives | `objectives.txt` | New `branches:` key → Tavus `next_conditional_objectives`. |
| SetupFields §5 guardrails | `guardrails.txt` | One block per row; they replace the template guardrails. |
| "45 minutes max", "auf Deutsch" | `settings.json` | `maxCallMinutes: 45`, `interviewMinutes: 35`, `languages: ["en","de"]` (Tavus restricts speech recognition to the listed languages, so German must be declared). |

Decisions:

* **`settings.json` (optional, per firm).** Holds greeting, durations, `inCallDebrief`, languages, `focusCommands`,
  perception queries and `cvUpload`. It is validated by Zod (unknown keys are errors) and included in the content hash.
  Firms without it keep the original defaults (20-minute calls, English, no in-call feedback).
* **Knowledge is inlined, not uploaded.** Tavus documents require a public URL (unusable on localhost) and are retrieved by
  RAG, which can miss a case's answer key. Prompt + knowledge is ~30k characters (~7.5k tokens) per firm, inside Tavus'
  guidance (degradation from ~15–20k tokens). Knowledge over 48k characters falls back to documents when the app is public.
* **In-call debrief + written scorecard.** These personas give a spoken debrief (1–5 scores on firm-specific categories).
  PrepRoom keeps its written results screen (1–10 on the six generic categories; confirmed by the owner) and tells the
  interviewer so. The scoring model receives the firm's knowledge base (case facts, answer keys, 1–5 rubric) to check
  calculations, and is told to judge independently of the interviewer's spoken verdict.
* **Focus presets.** The setup "focus" maps to the personas' own practice controls: Case / technical → "case only",
  Fit & behavioral → "fit only", Full interview → normal flow.
* **Levels per industry.** Consulting offers Intern (default, matching the personas), Working Student, Entry-level
  Consultant, Experienced Consultant, MBA Associate.
* **CV upload instead of per-interview knowledge documents.** The supplied workflow uploads `CV_First_Last.pdf` to the
  knowledge base and deletes it after the call. PrepRoom instead extracts the text in `/api/cv` (PDF or .txt, ≤5 MB; nothing
  stored) and passes it in that conversation's `conversational_context` (capped at 6k characters). That achieves the same
  "only this candidate's CV" guarantee without leaving personal data on the PAL. The personas' CV-matching instructions
  still work, because exactly one CV is present.
* **`end_call`** is a Tavus system tool available to every conversation (spec: `type=system`), so no configuration is needed.
  When the PAL ends the call, the interviewer leaves the Daily room and PrepRoom routes to the results screen.
* **Phoenix emotion tags removed (owner delegated the call).** The supplied prompts asked for a leading emotion tag on every
  reply and in `end_call`'s `response_to_user`. Tavus documents `<emotion value="…"/>` tags only for Echo mode; in the full
  pipeline Phoenix-4/4.5 faces express emotion automatically, guided by the prompt, so a literal tag risks being spoken.
  In all nine `systemprompt.txt` files that paragraph is replaced by a descriptive instruction (calm/neutral for questions,
  warm for friendly moments, rarely surprised, never say emotion names aloud), and `response_to_user` is plain "Goodbye.".
  Emotion-tag stripping on captions and transcripts stays as a safety net. This is the only edit to the supplied prompts.
* **Guardrails** are the supplied ones plus one added to every firm (owner-approved): `<prefix>_distress_handling`
  (pause, offer to reset or stop, no medical advice, point to emergency services in a crisis).
* **Placement and settings for IB and VC/PE.** Verdane and General Atlantic sit under "Venture Capital & Private Equity".
  IB focus presets map to "technicals only" / "fit only"; PE/VC to "case only" / "fit only". HV Capital uses its supplied
  30-minute interview with a 40-minute hard stop; all others 35 / 45.

## 12. Written scorecard is optional (no Anthropic key yet)

* The written scorecard runs only when `ANTHROPIC_API_KEY` is set (`scoringEnabled()` in `src/lib/env.ts`).
* Without it, ending a call sets the interview to **`ended`** immediately. The results page shows "Interview complete"
  (the interviewer's spoken debrief is the feedback), with retry links and the transcript once Tavus delivers it
  (fetched in the background; no score, no "failed" state).
* The interviewer's session context and the setup screens stop promising a written scorecard, and the persona is told its
  spoken debrief is the only feedback. Welcome-page copy was made true in both modes.
* Adding the key later re-enables the scorecard for new interviews with no code change. Interviews that ended without
  scoring keep their transcript and stay `ended`.
