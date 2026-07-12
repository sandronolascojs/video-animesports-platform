# Video Engine Architecture — AI Sports Anime Generator

> Analysis document. Decisions here gate the build. Verified against: kie.ai docs (2026-07-10), installed `ai@7.0.22` bundled docs, installed `alchemy@0.93.12` type definitions, Cloudflare docs (Workflows GA, Containers GA, R2, Media Transformations).

## 1. The assignment, restated as requirements

Build a consumer tool where a regular user recreates AI sports anime scenes:

- **Input**: a template (first: sports anime) + a main description ("Messi misses a penalty, gets offered a briefcase of money, the referee starts cancelling goals so Argentina wins…") + **aspect ratio (16:9 or 9:16)**.
- **Output**: an anime video with **consistent characters, consistent style, and a linear story**. The **first generation produces 3 scenes** (fast, cheap first feedback); the core loop is then **extending the story by adding scenes** — via the agent or manually — growing toward the 1–2 minute video. It is a **video producer**: scenes carry spoken dialogue (template language, e.g. Japanese for anime) and **styled subtitles that are burned into every rendered version**.
- **Mandated stack**: kie.ai as provider — `bytedance/seedance-2-mini` @ 480p for video, `gpt-image-2` for frames. Everything server-side on **Cloudflare Workers**.
- **Core domain**: `projects → scenes → assets → versions`, where a version is a re-renderable snapshot (replace/reorder scenes, re-render, roll back). Every row is **scoped to a `user_id` — accounts are fully isolated** (see Product hardening rules).
- **Error path = first-class**: generation failures, not-founds, empty and partial states are designed with the same rigor as the happy path (see Product hardening rules).

The engine's job in one sentence: **turn one prompt into a validated scene plan, then into keyframes, then into clips, then into one video — with coherence enforced at every hop.**

## 2. The coherence problem and how we solve it

Long AI video fails in three ways: characters drift, style drifts, cuts jump. The pipeline attacks each one structurally, not with prompt luck:

| Failure mode | Mechanism | Why it works |
| --- | --- | --- |
| Character drift | **Character sheets** generated once per character (gpt-image-2), then passed as reference images into *every* keyframe generation (`gpt-image-2-image-to-image` accepts up to **16 `input_urls`**) | The image model re-sees the canonical face/kit every time; consistency comes from pixels, not adjectives |
| **Environment drift** (the field, the stadium, the locker room looking different every scene) | **Location sheets**: the agent extracts distinct locations from the story (penalty area, tunnel, referee's room…); each gets ONE canonical establishing image (gpt-image-2) + a **location bible** (text block: stadium architecture, crowd colors, ad-board text, grass pattern, lighting, time of day). Every keyframe for a scene in that location receives the location sheet in `input_urls` AND the location bible in the prompt | Same pixel anchor + same text anchor per location across all its scenes; time-of-day/weather is planned data (`scenes.locationKey` + agent-set `timeOfDay`), so the sunset in scene 3 doesn't become noon in scene 7 |
| Style drift | **Structured StyleBibleSpec** (architecture/v2-prompt-craft): the agent FILLS 8 concrete fields — `artDirection`, `lineArt`, `colorScript`, `characterRendering`, `lighting`, `cameraGrammar`, `filmTexture`, `motionLanguage` — instead of writing one free string. A pure compiler, `compileStyleBible` (`apps/server/src/lib/style-bible.ts`, unit-tested), deterministically renders the spec into the canonical style block and ALWAYS appends a fixed hard consistency clause ("Single anime episode aesthetic… 2D cel anime only — no 3D, no photorealism, no live action.") that is never agent-authored. This compiled block is prepended verbatim to every downstream image/video prompt + previous keyframe passed as reference | Same anchor text + visual anchor in every call, plus a non-negotiable, non-paraphrasable consistency clause; Seedance has no seed param, so coherence must come from inputs |
| Jump cuts between scenes | **Keyframe fencing**: for N scenes we generate N+1 keyframes K1…KN+1; scene *i* is generated with `first_frame_url = Ki`, `last_frame_url = Ki+1`. As of architecture/v2-prompt-craft, each keyframe is its own LLM-authored chain entry — `{ description, charactersPresent, locationKey, shotScale, cameraAngle }` (shotScale/cameraAngle are a shared enum vocabulary, `packages/types`' `ShotScale`/`CameraAngle`) — not just a scene's prompt re-used verbatim; the plan agent's system prompt spells out the continuity rule explicitly: keyframe *i* is the END of scene *i-1* AND the START of scene *i*, and consecutive scenes must describe that ONE shared frozen frame identically. Each scene also carries its own `cinematography: { cameraMotion, motionNotes, pacing }`, compiled into the Seedance prompt (`buildSceneVideoPrompt`) — the system prompt explicitly demands shot-scale/angle/motion VARIETY across scenes (not three identical medium static shots) | Seedance's First & Last Frame mode is documented to keep those frames *identical* to the inputs — scene i ends on the exact image scene i+1 starts on. Seamless by construction, **zero frame extraction needed**; varied, explicit camera direction is what makes the result read as an edited episode rather than a slideshow |

Reference-image budget per keyframe (max 16): ~2–4 character sheets (only characters in that scene) + 1 location sheet + previous keyframe + optionally 1 style reference ≈ 4–7 — comfortable headroom. Reference SELECTION now follows each keyframe's own `charactersPresent`/`locationKey` (not the governing scene's full cast) — a keyframe boundary can legitimately show fewer characters than its scene (e.g. the instant before someone enters frame).

**Extending the story (the core loop)**: adding scene N+1 to an existing project reuses the same fencing — the new scene's `first_frame_url` is the CURRENT last scene's end keyframe (K_end, already an asset, never regenerated). The extendStory agent receives the compiled style block + that end keyframe's `description` + the story-so-far, and must produce exactly one new scene AND its keyframe (the new K_new), chaining visually from the given description rather than redescribing it — style bible + location bible + character sheets remain the reference images for K_new. One new keyframe + one new clip per added scene; existing assets never regenerate. This is why 3-scene starts are cheap and extension is linear-cost.

This "keyframe-first" design has a product benefit too: keyframes are cheap and fast; the user can review/regenerate the storyboard **before** paying for expensive video generation. This is how the serious long-form products (storyboard-first pipelines) structure it.

**Compat note**: `projects.plan` (jsonb, no migration path) may still hold rows from before this upgrade — missing `styleBibleSpec`/`keyframes`/per-scene `cinematography`. A single helper, `normalizeProjectPlan` (`apps/server/src/lib/plan-compat.ts`, unit-tested), heals such a plan on read by defaulting the missing pieces to a plain rendition of the pre-upgrade behavior (the scene's own prompt as keyframe description/motion notes, a neutral medium/eye-level/static camera) — called at the two read sites that can see a legacy plan (`generation.service.ts::runExtensionPlanStep`, which also persists the healed shape going forward; and `workflows/video-generation.ts::runSceneRetryMode`). A freshly-generated or freshly-extended plan is always already structured and never needs it.

### Chaining decision

- **Chosen**: First & Last Frame conditioning (`first_frame_url` + `last_frame_url`), officially supported and documented as exact.
- **Rejected**: last-frame extraction + continuation. `return_last_frame` is deprecated on Seedance 2/2-fast and *undocumented* on mini; Workers can't run ffmpeg to extract frames ourselves. (If ever needed: Cloudflare Media Transformations `mode=frame` via the `[media]` Worker binding — open beta — can extract a frame from an R2 MP4. Kept as an escape hatch, not a dependency.)

## 3. Provider layer: kie.ai (verified facts)

Everything is task-based and async: `POST /api/v1/jobs/createTask` → `taskId` → callback and/or `GET /api/v1/jobs/recordInfo?taskId=`.

| Concern | Fact | Consequence |
| --- | --- | --- |
| Auth | `Authorization: Bearer <key>` | secret binding on the server Worker |
| Video model | `bytedance/seedance-2-mini`: `prompt`, `first_frame_url`, `last_frame_url`, `resolution: "480p"`, `aspect_ratio: "16:9"`, `duration: 4–15s` (int), `generate_audio` (default true) | 8 scenes × ~10s ≈ 80s video. First&Last mode is mutually exclusive with reference-video mode |
| Image model | `gpt-image-2-text-to-image` (sheets, K1) and `gpt-image-2-image-to-image` (`input_urls[]` up to 16 — K2…KN+1 with character sheets + previous keyframe) | consistency mechanism confirmed |
| Callbacks | `callBackUrl` on createTask; HMAC-SHA256 signature headers (`X-Webhook-Timestamp`, `X-Webhook-Signature`, key from settings). Exact callback body under-documented. **As implemented**: the signed string is `taskId + "." + timestamp` (not the raw request body) — see `packages/kie/src/webhook.ts::verifyWebhookSignature` | **Polling only, with THIS project's API key**: the challenge kie.ai key has no webhook/callback access configured (confirmed), so no `callBackUrl` is ever sent on any createTask call — `/webhooks/kie` never receives real traffic. Every task's completion is discovered by polling `recordInfo` (`getTask`) on a `step.sleep`-backed backoff loop, with a budget per task kind (images ~8 min, scene video ~19 min, TTS ~5 min — `apps/server/src/workflows/video-generation.ts`'s `waitForKieTask`/`*_POLL_BUDGET`). The HMAC verification code and the webhook route stay in the codebase — wired, unit-tested — **dormant**, for a future key that does have callback access |
| Result files | Temporary URLs, expiry conflictingly documented as 24h/14d | **Copy to R2 immediately** on completion; never store kie URLs as canonical |
| Inputs | By public URL | Serve inputs from R2 via our existing presigned GET URLs (`packages/storage`) |
| Rate limits | 20 createTask / 10s; 100+ concurrent; 429 = no queueing | Workflow paces requests; sequential-per-project is naturally under the limit |
| Credits | Prepaid; `GET /api/v1/chat/credit`; 402 on empty | Check balance before a generation run; record `creditsConsumed` per task |
| State machine | `waiting → queuing → generating → success/fail` + `failCode/failMsg` | Maps 1:1 to our `generations.status` |

**Open items needing one API key test** (flagged, not blockers): exact credit cost of mini@480p and gpt-image-2, real latency (~3 min per 5s clip per third-party tests), and **celebrity likeness policy (Messi)** — undocumented. Mitigation if blocked: template prompts describe "Argentina's number 10, small, bearded" instead of the name; anime stylization usually passes.

## 4. Orchestration: Cloudflare Workflows

A full run is: 1 plan (LLM) + ~4 character sheets + ~9 keyframes + ~8 video tasks + ~8 R2 ingests + 1 assembly — each external task takes 1–5 min and can fail. This is exactly what **Cloudflare Workflows** (GA since 2025-04, supported by installed alchemy as `Workflow(...)` binding — verified in `alchemy/lib/cloudflare/workflow.d.ts`) is for:

- `step.do(name, { retries, timeout }, fn)` — checkpointed, retried, idempotent per step.
- **Polling only** (no callback mechanism with the challenge API key — see §3's Callbacks row): a `step.sleep`-backed backoff loop polls `getTask`/`recordInfo` until each task resolves, budget sized per task kind. `step.waitForEvent`/`instance.sendEvent()` (the callback-driven path a future callback-capable key would use) and the `/webhooks/kie` route stay wired and tested but are not exercised by this workflow today.
- Step wall-clock is **unlimited**; streaming a 10–60MB MP4 from kie into R2 inside a step is comfortable (128MB isolate is fine because we stream, never buffer; note: R2 `put` needs a known length — kie/CDN sends `Content-Length`, else wrap in `FixedLengthStream` or use our multipart lib).
- Paid plan limits (10k steps, 1GB state, 50k concurrent instances) are orders of magnitude above our ~40 steps/project.

**Rejected**: Queues (no ordering guarantee, 128KB messages, no wait-for-event — we'd hand-roll a state machine) and DO alarms (single alarm, hand-rolled retries). Both re-implement Workflows badly.

```
VideoGenerationWorkflow (per project generation)
├─ step.do  plan            → agent generates StoryPlan (or reuse persisted plan)
├─ step.do  character[i]    → createTask gpt-image-2 (sheet) ─┐
├─ step.sleep poll loop     ←──────────────────────────────────┘  → ingest sheet to R2
├─ step.do  keyframe[K1..KN+1] → gpt-image-2 i2i (sheets + prev keyframe as refs) → poll → ingest
├─ step.do  scene[i]        → speech FIRST: createTask TTS → poll → ingest → sign as reference_audio_urls
│                              then createTask seedance-2-mini (first=Ki, last=Ki+1, reference_audio_urls) → poll → ingest
└─ step.do  finalize        → status ready/failed (assembly: see §5)
```

**As implemented (fix-pass W5)**: no Workflow step ever marks a version/project "assembling" — R1 rendering is entirely browser-driven (§5, §9's "MVP path (browser)"), triggered by the client calling `versions.render`/`markRendered` after the workflow above has already finished. `ProjectStatus.ASSEMBLING` is reserved for the future R2 canonical renderer, where the Workflow's own assembly step would set it.

Every step writes progress to Postgres (scene/generation status), so the web UI polls one cheap query (or subscribes) and renders a live storyboard filling itself in.

## 5. Final assembly (the one thing neither kie.ai nor Workers can do)

Verified: **kie.ai has no concat/stitch endpoint. Cloudflare Stream cannot merge. ffmpeg/WASM cannot run inside a Worker** (memory + no WebCodecs in workerd). Same-model Seedance clips share codec params, so concat is a **remux** (no re-encode). Options, decided:

| Option | Verdict |
| --- | --- |
| **Render milestone R1: browser-side remux with Mediabunny** (~pure TS, MPL-2.0, the engine behind Remotion's `@remotion/media`) — read the ordered clips from R2 (signed GETs), shift packet timestamps, write one MP4, upload via our existing multipart presigned lib | ✅ First end-to-end render (no subtitles/voice yet). Zero server infra, seconds of work for 480p 3-scene videos |
| **Render milestone R2 — the canonical version renderer: Cloudflare Containers + ffmpeg** (GA 2026-04; `Container` resource confirmed in installed alchemy) — triggered from the Workflow's assembly step, R2 in/out: `concat` + **subtitle burn-in (ASS, compiled from the project's subtitle style + per-scene dialogue)** | ✅ **Required once subtitles land** — "every rendered version ships with subtitles burned in" forces a re-encode, which browser remux cannot do. Deterministic server render, no browser needed, versions reproducible. **No separate dialogue audio-mix pass needed** (architecture/v2-voice-pipeline): dialogue is already lip-synced in-clip via Seedance's `reference_audio_urls` (or spoken via `generate_audio` as a fallback), so concat just carries each clip's own baked-in audio through unchanged |
| Remotion Lambda / external render APIs (fal.ai compose, Shotstack, Rendi) | ❌ Violates the Cloudflare constraint (AWS) or adds a second vendor; Remotion licensing kicks in at 4+ employees. Noted, rejected |
| Cloudflare Stream / Media Transformations | ❌ Clip/trim/frame-extract only, no concat |

**Preview** (independent of export): `@remotion/player` in the editor renders the timeline data-driven — `<Sequence>` per scene playing the R2 clip **plus the subtitle overlay rendered from the same subtitle-style object** — giving real-time subtitle/style preview with **no server rendering at all**. One style object drives both surfaces: Player CSS in preview, ASS style at burn time. (R2 CORS already exposes `range`/`content-range`/`etag` — configured for exactly this.)

## 5b. Audio, language & subtitles (the "video producer" layer)

The product produces videos with spoken dialogue and styled subtitles — not silent clips.

**Language model**:
- Each **template defines the defaults**: `sports-anime` → **audio `ja` (Japanese voice), subtitles `en` (English)** — anime speaks Japanese by default.
- **Fully adjustable per project at creation**, two ways: (a) the language chips in the PromptDock toolbar, or (b) **just asking in the prompt** — "make the whole video in English" → the plan agent detects the language request and sets audio+subtitles accordingly. Explicit user request always beats the template default; template default applies when the user says nothing.
- Audio and subtitle languages are **independent** (Japanese voice + Spanish subs is valid).
- The plan agent writes each scene's `dialogue` in the **audio language**, plus `subtitleText` in the chosen **subtitle language** (both stored on the scene; more subtitle languages later — it's data).

**Voice (TTS)** (architecture/v2-voice-pipeline): dialogue is **lip-synced in-clip**, not mixed at export. Per scene, in this order: (1) TTS runs **BEFORE** the scene's video task — kie.ai's `elevenlabs/text-to-speech-multilingual-v2` (kie-API-only: same `createTask`/`KIE_API_KEY` as every other provider call, no direct ElevenLabs API access) generates the dialogue audio from the scene's `dialogue` text and the project's per-language voice (`TTS_VOICE_BY_LANGUAGE`, `packages/types`); (2) the resulting audio asset is signed and handed to Seedance (`bytedance/seedance-2-mini`) as `reference_audio_urls` (max 3 files, 2–15s, wav/mp3, ≤15MB — kie.ai verified facts), which lip-syncs the on-screen character to it while rendering the clip. Seedance's own `generate_audio` (default true) keeps layering ambient/SFX underneath. A scene with no dialogue (silence is a valid beat) skips TTS entirely; a TTS failure, timeout, or an out-of-bounds asset duration (`isReferenceAudioDurationValid`) skips the reference-audio step but is otherwise **non-fatal**: the scene video still generates, and the Seedance prompt still carries the dialogue line — worded as "speak it yourself via `generate_audio`" instead of "lip-sync to this reference" (`buildSceneVideoPrompt`'s two dialogue-clause wordings) — so voice degrades gracefully rather than being silently dropped. Voice selection per character (not just per language) is a v-next refinement.

**Subtitles**:
- Stored as **data on the scene** (text + language), timed per scene (scene-level timing MVP; word-level later).
- **Style is a project-level `subtitle_style` object** (font, size, weight, color, outline, background, position) — **editable in the Studio with real-time preview**: the Remotion Player renders the overlay from this object live as the user tweaks styles.
- **Every version render burns the subtitles in**: at assembly, `subtitle_style` + per-scene dialogue compile to an ASS track, ffmpeg (Containers) burns it during the concat/mix pass. One style object → two compilers (Player CSS, ASS) — never two sources of styling truth.

## 5c. Product hardening rules (error path = happy path)

These are architecture rules, not polish:

1. **Failure is scene-scoped, never project-fatal.** A failed generation marks THAT scene/generation `failed`; the project keeps loading, the storyboard shows the failure in place with a **Retry** action (retries just that generation step — the `generations` row is the resume anchor). Workflow steps already retry with backoff; provider-rejection errors (`NonRetryableError`) surface to the user instead of silently dying.
2. **Every surface has its non-happy states designed**: not-found (project/scene/version → proper 404 UX), empty (no projects yet, no versions yet), partial (some scenes ready, some generating, some failed — all coexist in one storyboard), stale (kie URL expired before ingest → re-fetch via `recordInfo`).
3. **Idempotency everywhere**: webhooks replay-safe (generation keyed by `provider_task_id`), workflow steps checkpointed, render of the same version reproducible.
4. **Multi-tenant isolation via `user_id`**: every table hangs off the owning user (`projects.user_id`, cascade down); **every oRPC procedure and every agent tool filters by the session user** — a tool must never read or mutate another user's project; R2 keys are prefixed `users/{userId}/projects/{projectId}/…`. This is a written invariant, enforced in the repository layer (all queries take the userId), not a convention.
5. **Aspect ratio is a first-class input**: `16:9` or `9:16`, chosen at creation, flowing through gpt-image-2 `aspect_ratio`, Seedance `aspect_ratio`, the Remotion composition dimensions, the Player, and the timeline thumbnails. No hardcoded 16:9 anywhere.

## 5d. Security rules (layered, Postgres/Neon-native where possible)

Defense in depth: the repository filter (§5c.4) is layer 1; these make a repo-layer bug non-exploitable.

### Database — Postgres RLS as the enforcement backstop

1. **Denormalized `user_id` on every tenant table** (projects, characters, locations, scenes, assets, generations, project_versions), indexed. Costs one column; buys cheap RLS policies and cheap audits (no join-walking in policies).
2. **Row Level Security enabled on every tenant table** — first-class in the installed stack (verified: `pgPolicy` in drizzle-orm@0.45.2 pg-core; drizzle-kit generates the policy DDL in migrations; `drizzle-orm/neon` also ships `crudPolicy`/`authUid` as a Neon-JWT alternative we don't need). Policies live IN the schema files next to their tables:
   ```ts
   pgPolicy("tenant_isolation", {
     for: "all",
     using: sql`user_id = current_setting('app.user_id', true)`,
     withCheck: sql`user_id = current_setting('app.user_id', true)`,
   })
   ```
   **Queries do not change at all** — repositories keep their explicit `where user_id` filters and read/write exactly as without RLS. The single runtime addition is one `withUser(userId, fn)` helper in `packages/db` that wraps a request's queries in a transaction running `SET LOCAL app.user_id = $sessionUserId` first (SET LOCAL is transaction-scoped — safe with the pooled `maxUses:1` connections). Failure mode is CLOSED: a query missing the wrapper returns zero rows (loud in dev), never another tenant's data.
3. **Two DB roles**: `app_runtime` (DML only, **no BYPASSRLS, no DDL**) used by the Worker; `app_migrator` (owner) used only by drizzle-kit migrations locally/CI. Runtime credentials can't alter schema or skip policies.
4. **Cascade integrity**: `ON DELETE CASCADE` down the ownership tree (user → projects → children) — account deletion is one statement, no orphans.
5. **Neon hygiene**: separate **branches per environment** (dev branch ≠ prod branch — dev can never touch prod rows); separate credentials per env via the alchemy stage; TLS required (`sslmode=require`); point-in-time restore is the recovery story.

### API & agent

6. Everything behind `protectedProcedure` except `healthCheck`. Ownership misses return **NOT_FOUND, never FORBIDDEN** (don't leak resource existence).
7. Zod at the contract boundary caps everything: prompt/description max lengths, enum-only fields, bounded arrays — no unbounded user input reaches the agent or kie.
8. **Agent tools get `userId` from the server session, never from model input.** No tool parameter can name a user or project the session doesn't own (project id resolved through the scoped repo). Tool loop capped (`stopWhen` max steps); expensive tools behind explicit confirmation (already specced).
9. **Prompt-injection posture**: scene prompts/dialogue are user data — when replayed into agent context they are data, not instructions; the only effectors are the scoped tools, so a hijacked generation can at worst edit the attacker's own project.

### Storage, secrets, edges

10. R2 stays private; presigned URLs short-lived (PUT ≤15min, GET ≤1h); keys always `users/{userId}/projects/{projectId}/…` and validated (no traversal — already in `packages/storage`). After any user upload: verify object size + content-type server-side **before** creating the asset row (a presigned PUT cannot enforce size).
11. Secrets exist only as Worker secret bindings (alchemy `secret`) — kie key, R2 creds, auth secret. Web app receives zero provider credentials. `.env` files stay gitignored.
12. Webhooks: HMAC verification (already) **plus timestamp tolerance (~5 min skew) against replay**; processing idempotent by `provider_task_id`. **As implemented**: the signed string is `taskId + "." + timestamp`, not the raw request body (`packages/kie/src/webhook.ts`); the route also bounds request size to 64KB before ever reading the body (fix-pass W2).
13. Auth: better-auth cookies `httpOnly` + `secure` (already); `trustedOrigins` pinned; enable better-auth's rate limiting on auth endpoints. One active generation workflow per project (correctness guard, doubles as abuse brake). **As implemented**: also DB-backed per-user rolling-hour quotas as a billing-DoS backstop on top of better-auth's own limiter — `MAX_PROJECTS_PER_HOUR` (5) on `projects.create`, `MAX_GENERATION_KICKS_PER_HOUR` (20) on `projects.extend`/`scenes.retry` (fix-pass B3, `packages/types/src/constants.ts`).
14. Never log secrets, presigned URLs, or full prompts at info level; `generations` is the audit trail.

## 6. Data model

Follows the repo conventions: enums in `packages/types` → `pgEnum` in `packages/db/src/shared/enums.ts`, one file per table, `id()` cuid2 helper, FKs as `text(...).references()`.

```
projects            id, user_id → user (ISOLATION ROOT — all access filters by this),
                    template_key, title, description, status: project_status,
                    aspect_ratio: aspect_ratio ('16:9' | '9:16', chosen at creation),
                    audio_language, subtitle_language,
                    style_bible jsonb, subtitle_style jsonb (font/size/color/outline/position),
                    draft_timeline jsonb — THE single source of truth for scene order &
                    composition: [{ sceneId, videoAssetId, durationSeconds }]. Scenes carry
                    NO order column; creation appends here, reorder/extend mutate here,
                    versions snapshot here. One authority, no sync bugs.

characters          id, project_id → projects, name, role, visual_description,
                    sheet_asset_id → assets (nullable until generated), sort

locations           id, project_id → projects, key, name, description (the location bible),
                    time_of_day, sheet_asset_id → assets (nullable until generated)

scenes              id, project_id → projects, location_id → locations,
                    title, prompt, duration_seconds,
                    dialogue (audio-language text), subtitle_text (subtitle-language text),
                    status: scene_status,
                    start_keyframe_asset_id → assets, end_keyframe_asset_id → assets,
                    video_asset_id → assets, audio_asset_id → assets (TTS dialogue track)

scene_characters    scene_id + character_id (composite PK)  — which characters appear per scene

assets              id, project_id → projects, kind: asset_kind
                    (character_sheet | location_sheet | keyframe | scene_video |
                     scene_audio | final_video),
                    r2_key (prefixed users/{userId}/projects/{projectId}/…),
                    mime_type, width, height, duration_seconds,
                    metadata jsonb, created_at

generations         id, project_id, scene_id?, kind: generation_kind (sheet | keyframe | scene_video),
                    provider ('kie'), model, provider_task_id (unique — idempotency),
                    status: generation_status (waiting | queuing | generating | success | fail),
                    input jsonb, result jsonb, credits_consumed, fail_code, fail_msg,
                    created_at, completed_at        — full audit + cost trail + retry anchor

project_versions    id, project_id → projects, number (int, unique per project),
                    timeline jsonb  — ordered snapshot: [{ sceneId, videoAssetId, durationSeconds }],
                    final_video_asset_id → assets (nullable until assembled), created_at
```

Design notes:

- **`generations` is the pipeline's spine**: one row per kie task. The webhook route resolves `provider_task_id → generation → workflow instance` and is idempotent by construction. Cost tracking (`credits_consumed`) comes free.
- **`project_versions` = the user's ask** ("historial de cambios"): the timeline is *data*, not files. Reorder/replace scenes → new immutable version row → assemble → new `final_video_asset_id`. Rolling back = pointing at an old version. Re-render only re-does assembly (clips are content-addressed by asset).
- **Templates as code, not tables** (MVP): a `templates` object in `packages/types` (key, name, style-bible seed, agent instructions, example prompts). A DB table adds nothing until templates are user-editable.
- Enums added to `packages/types`: `ProjectStatus` (draft | planning | storyboard | generating | assembling | ready | failed), `SceneStatus` (planned | keyframe_pending | keyframe_ready | video_pending | video_ready | failed), `AssetKind`, `GenerationKind`, `GenerationStatus`.

## 7. The agent (AI SDK `ai@7.0.22`, installed)

Verified against the bundled version-matched docs:

- **Structured output is `generateText` + `output: Output.object({ schema })`** (`generateObject` is deprecated in v7). Zod v4 (^4.1.8) — our `zod@4.4.3` is compatible.
- Model access via **Vercel AI Gateway** (`AI_GATEWAY_API_KEY` binding; plain `"anthropic/claude-…"` model strings). No provider SDK packages needed.
- The **StoryPlan zod schema lives in `packages/api`** (it's contract: web renders the plan, server generates it). As of architecture/v2-prompt-craft the LLM writes the FULL structured art direction + cinematography, not a story outline: `{ title, synopsis, styleBibleSpec: { artDirection, lineArt, colorScript, characterRendering, lighting, cameraGrammar, filmTexture, motionLanguage }, characters: [{ name, role, visualDescription }], locations: [{ key, name, description, timeOfDay }], scenes: [{ title, prompt, dialogue (audio language), subtitleText (subtitle language), durationSeconds, characterNames, locationKey, cinematography: { cameraMotion, motionNotes, pacing } }], keyframes: [{ description, charactersPresent, locationKey, shotScale, cameraAngle }] }` with hard bounds enforced by zod — the schema *is* the guardrail, including the array-length bounds: `scenes.length === INITIAL_SCENE_COUNT` and `keyframes.length === INITIAL_SCENE_COUNT + KEYFRAME_COUNT_OFFSET` (the N+1 fencing math, §2). `shotScale`/`cameraAngle`/`cameraMotion`/`pacing` are zod enums built from `packages/types`' as-const vocabulary (`ShotScale`, `CameraAngle`, `CameraMotion`, `Pacing`) — shared, never redeclared. **Initial plan = exactly 3 scenes** (4–15s each); extensions add one scene PLUS one new keyframe via a separate `extendStory` schema — `{ scene: <same scene shape>, keyframe: <same keyframe shape> }` — whose system prompt receives the compiled style block + the story's CURRENT last keyframe description (the new scene's implicit start anchor, which it must chain from, not redescribe) + the story-so-far as context. Dialogue length is a system-prompt guidance budget, not a zod bound: ~`DIALOGUE_WORDS_PER_SECOND` (2.5) words per second of `durationSeconds` (`packages/types`).
- **Deterministic compilation, not agent output, produces model-ready prompts**: `apps/server/src/lib/style-bible.ts` (`compileStyleBible`) and `apps/server/src/lib/prompt-builders.ts` (`buildCharacterSheetPrompt`, `buildLocationSheetPrompt`, `buildKeyframePrompt`, `buildSceneVideoPrompt`, plus the `compileShotScale`/`compileCameraAngle`/`compileCameraMotion`/`compilePacing` enum-to-English compilers) are pure, DB-free, unit-tested functions that assemble the LLM's structured output into the exact strings sent to gpt-image-2/Seedance — the LLM never writes a raw provider prompt directly. A shared `joinPromptSections` helper caps total compiled length (`MAX_COMPILED_PROMPT_LENGTH`, a defensive generous bound — kie.ai publishes no exact provider-side cap) and drops lowest-priority trailing sections (flourish, never the style block/anchor clauses) if ever exceeded. See §2's compat note for how a pre-upgrade `projects.plan` row is healed before reaching these builders.
- One-shot planning is enough for the plan step: single `generateText` call with template instructions + user description. Optional UX upgrade: `streamText` + `useObject` on the client to show the plan appearing live.
- **Second agent — the Studio dock agent** (`ToolLoopAgent`): a chat agent in the Studio that *operates* the project through typed tools (updateScene, reorderScenes, regenerateKeyframe, regenerateSceneVideo, renderVersion…), each a thin wrapper over the same oRPC services the buttons use. Project snapshot injected as context per request; expensive tools gated behind tool-approval confirmation cards. Streamed with `useChat` + the installed AI Elements components. Full design: `docs/studio-ui.md`.
- `ai` must be added to `apps/server` deps (currently only in web).
- Aside for the README: the installed `@ai-sdk/gateway` already types `openai/gpt-image-2` and `bytedance/seedance-2.0` as gateway image/video models, and `experimental_generateVideo` supports `frameImages: [{ frameType: 'first_frame' | 'last_frame' }]` — so the provider layer is designed as an interface with kie.ai as the mandated implementation and AI Gateway as a drop-in alternative. Costs one abstraction we already need (see `packages/kie` below).

## 8. Where everything lives (monorepo mapping)

Existing architecture rules apply unchanged (contract-first api, router → service → repository, db only in repositories, storage lib server-only):

```
packages/types      + enums (ProjectStatus, SceneStatus, AssetKind, GenerationKind, GenerationStatus)
                    + templates (sports template: style bible seed, agent instructions)
packages/api        + schemas/story.ts (storyPlanSchema…), schemas/project.ts, schemas/scene.ts
                    + contracts: projects.*, scenes.*, versions.* procedures
packages/db         + schema/{project,character,scene,scene-character,asset,generation,project-version}.ts
                    + shared/enums.ts additions
packages/kie        NEW — kie.ai client: createTask/recordInfo/webhook-verify, typed per model
                    (zod-validated inputs/outputs, zero business logic; pure provider adapter)
packages/storage    unchanged (already does presigned GET/PUT + multipart — used for R2 in/out)
apps/server         + routers/{projects,scenes,versions}.ts → services → repositories
                    + workflows/video-generation.ts (WorkflowEntrypoint)
                    + Hono route POST /webhooks/kie (HMAC verify → sendEvent)
                    + services/{planning,generation,assembly}.service.ts
packages/infra      + Workflow binding, KIE_API_KEY/KIE_WEBHOOK_SECRET/AI_GATEWAY_API_KEY secrets
                    (R2 bucket/token/CORS already done; add R2 binding to server worker for streaming puts)
apps/web            + feature/projects (list/create), feature/studio (Studio screen: player canvas,
                      timeline strip, history panel, storyboard, assets, AGENT DOCK) — layout,
                      component map (shadcn + AI Elements reuse) and agent-dock design in docs/studio-ui.md
apps/server         + POST /api/agent/chat (Hono streaming route for the dock agent)
```

## 9. End-to-end flows

**Create + plan** — `projects.create({ templateKey, description })` → row + `generateText(Output.object)` → persist characters/scenes (status `storyboard`) → UI shows editable plan. Cheap, synchronous (seconds).

**Generate** — `projects.generate(projectId)` → create Workflow instance → sheets → keyframes (each: createTask → waitForEvent/poll → ingest R2 → asset row → status update) → scene videos (first/last keyframes) → version created with default timeline → status `ready`. UI polls project status and fills the storyboard live.

**Webhook** — kie POSTs → verify HMAC (timestamp + taskId) → look up generation by `provider_task_id` → `instance.sendEvent({ type: "kie-task", payload: { taskId } })` → the waiting step re-fetches `recordInfo` (authoritative) and proceeds. Idempotent: replayed callbacks hit a completed step and are ignored.

**Edit + re-render (versions)** — editing NEVER mutates existing assets: regenerating a scene produces new keyframe/clip assets; reordering only changes the order array. `versions.create({ timeline })` snapshots `[{ sceneId, videoAssetId, durationSeconds }]` as an immutable row, then renders it:

- **Rendering a version = assembly only.** Untouched clips are never regenerated — the timeline references assets by id, so a re-render costs one concat, not N video generations.
- **MVP path (browser)**: editor fetches the version's clips via signed GET URLs → Mediabunny remux-concat (same-codec Seedance clips → no re-encode, seconds of work) → multipart upload to R2 → `versions.markRendered(versionId, assetId)`. Deterministic: same timeline + same assets → same output.
- **V2 path (server, Cloudflare Containers)**: the Workflow's assembly step passes the timeline manifest (R2 keys) to an ffmpeg container (`-f concat -c copy`), which writes the final MP4 back to R2 and updates the version row. Enables server-initiated re-renders with no browser open — same manifest, same output, swap is invisible to the rest of the system.
- **Preview without rendering**: Remotion Player plays any timeline (including unsaved drafts) directly from the per-scene clips — users see the edit instantly and only pay assembly when they export.
- **Rollback is free**: old versions keep their `final_video_asset_id`; switching back re-points the project, zero re-render.

### Editor state, history panel, undo/redo

Three layers, strictly separated:

1. **Draft timeline (mutable, one per project)** — what the editor edits: `projects.draft_timeline` (jsonb, same shape as a version's timeline), persisted debounced as the user reorders/replaces scenes. The Remotion Player previews the draft live.
2. **Versions (immutable, created ONLY by rendering)** — hitting "Render" snapshots the current draft into a new `project_versions` row (auto-incremented `number`), runs assembly, attaches `final_video_asset_id`. **Every render = one version; no version without a render.**
3. **History panel (right side)** — lists versions newest-first (number, date, thumbnail = first keyframe, status). Clicking a version loads its timeline into the draft (`draft_timeline := version.timeline`) and shows its rendered MP4. Non-destructive: versions are never edited or deleted; "restoring" just copies data into the draft. Render again after restoring → new version at the top.

**Undo/redo**: client-side stack over draft-timeline edits (an in-memory array of timeline states in the editor store — reorder, replace, remove, duration change each push an entry; Ctrl+Z/Ctrl+Shift+Z walk it). Session-scoped and cheap — no server round-trips, no schema. The durable, cross-session history is the versions list itself. Server-side undo journaling is deliberately out of scope: versions already cover it at the granularity users care about (rendered states).

## 10. Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Celebrity likeness (Messi) blocked by provider | High, undocumented | Test with real key on day 1; template falls back to trait-based descriptions ("Argentina's #10"); anime style reduces blocks |
| kie.ai stability ("may be slightly lower than official providers" — their words) | Medium | Workflows retries per step; `generations` audit makes any task resumable/replayable |
| Callback body under-documented | Low | Callback = trigger only; `recordInfo` = truth; poll fallback always on |
| Result URL expiry (24h worst case) | Low | Ingest to R2 in the same step that observes success |
| Latency (~3 min/clip × 8 scenes ≈ 25–30 min/video sequential) | Medium (UX) | Storyboard-first UX gives value at minute 1 (plan + keyframes); scenes *can* parallelize (keyframes exist before any video: fan out video steps, rate-limit-aware) — sequential for MVP, parallel is a flag flip |
| Mini pricing/`return_last_frame` unknowns | Low | We don't depend on `return_last_frame` at all; verify prices with key |
| Browser assembly needs an open tab | Low (MVP) | Documented Containers v2 path; timeline is data so nothing is lost |

## 11. Build plan (phased, each phase shippable)

> Delivery order is governed by the **release plan in `docs/studio-ui.md` §6 (v1 UI → v2 pipeline → v3 agent)**. The phases below map onto it: phases 1–4 = v2, phase 5's UI shell moved into v1, phase 6 = v3.

1. **Domain** — types enums + db schema + migrations + repositories. (Small)
2. **Plan agent** — `packages/api` story schemas + `projects.create/get/list` + agent service + storyboard UI (plan visible). *Demo-able: prompt → full storyboard.*
3. **kie adapter + keyframes** — `packages/kie` + webhook route + character sheets + keyframes into R2, shown in storyboard. *Demo-able: consistent character images.*
4. **Workflow + scene videos** — Workflow binding in alchemy + full generation pipeline + live progress UI. *Demo-able: real chained clips.*
5. **Studio + assembly + versions** — Studio shell (player, timeline strip, history panel), Mediabunny export → R2, `project_versions`. *Demo-able: the full product loop.*
6. **Agent dock** — chat streaming + read/free-write tools, then generation tools with confirmation cards (see docs/studio-ui.md §6). *Demo-able: "edit scene 3…" via chat.*
7. **Stretch** — Containers ffmpeg assembly, parallel scene generation, TTS/dialogue track (kie has ElevenLabs endpoints).

## 12. Decision summary

| Decision | Choice |
| --- | --- |
| Scene chaining | Keyframe fencing + Seedance First & Last Frame mode (no frame extraction) |
| First generation / growth | 3 scenes initially, then extend one scene at a time — new scene chains from the last end keyframe, existing assets never regenerate |
| Character coherence | gpt-image-2 i2i with character sheets + prev keyframe as refs (≤16), style bible in every prompt |
| Environment coherence | Location sheets (one establishing image per location) + location bible text + planned time-of-day per scene |
| Audio & subtitles | Template default language (anime→ja); project picks voice + subtitle language; TTS via kie ElevenLabs; subtitle_style object drives Player overlay (live preview) AND ASS burn-in at render |
| Scene order | `projects.draft_timeline` is the ONLY ordering authority (no sort column on scenes); versions snapshot it |
| Tenancy | user_id isolation root: repository-layer filtering, agent tools scoped, R2 keys prefixed per user |
| Security backstop | Postgres RLS on every tenant table (SET LOCAL app.user_id per tx) + denormalized user_id + runtime role without BYPASSRLS/DDL + Neon branch per env |
| Aspect ratio | 16:9 / 9:16 selectable at creation, flows through image gen, video gen, composition, player, timeline |
| Error path | Scene-scoped failures + per-step retry; not-found/empty/partial states designed; project always loads |
| Orchestration | Cloudflare Workflows (waitForEvent + poll fallback), alchemy `Workflow` binding |
| Provider integration | New `packages/kie` adapter; callback = trigger, `recordInfo` = truth; ingest to R2 immediately |
| Data core | projects / characters / scenes / assets / generations / project_versions — timeline as data, versions immutable |
| Agent | AI SDK v7 `generateText` + `Output.object`, schemas in `packages/api`, models via AI Gateway |
| Assembly | R1: browser Mediabunny remux (no subs, first e2e). R2 canonical: Cloudflare Containers ffmpeg — concat + ASS subtitle burn + audio mix. Preview: Remotion Player with live subtitle overlay |
| Constraint check | Everything server-side runs on Workers ✅ (assembly is client-side in MVP, Containers — still Cloudflare — in v2) |
