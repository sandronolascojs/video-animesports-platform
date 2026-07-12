# AI architecture v1 — packages/ai, Studio agent, create modal, versions-as-renders

Status: **agreed direction** (2026-07-12). Companion to
`scenes-architecture-v3.md` (which owns the scenes/generation data model).
This doc owns everything AI-shaped: the foundations package, the Studio
agent, the create-project surface rework, and the versions contract.

## 1. Create surface rework (kill the global dock)

The floating AI dock stays ONLY where it earns its place:
- **Dashboard** (`/`): hero composer + floating dock past the hero (as today).
- **Studio** (`/projects/[id]`): its own dock (becomes the agent chat — §2).

Everywhere else (Projects page, Assets page, future routes) the global
floating dock is REMOVED. In its place:

- **`CreateProjectModal`** — a Dialog that is visually NOT a dialog: no
  header, no footer, no chrome — ONLY the chat input surface (`AIDockInput`
  in hero mode with the full selector toolbar: aspect / voice / subtitles /
  scenes). Transparent-feeling shell, the glass input floating over the
  scrim.
- Managed by **`CreateProjectModalProvider`** mounted in the app providers
  (`components/providers.tsx`), exposing `useCreateProjectModal(): {
  open(): void }` — openable from ANYWHERE (sidebar "New project" pill,
  empty states, palette actions). Submit = same shared
  `createProjectInputSchema` + `useCreateProject` flow → `router.push` to
  the Studio.
- `focusNewProject()` routing logic simplifies to: Dashboard → focus hero
  composer (existing event); everywhere else → `open()` the modal (Studio
  included — creating a new project from inside a project is a modal case).
- `CreateDockProvider`/`GlobalCreateDock` are deleted (the provider's form
  logic moves into the modal component).

## 2. Studio agent (the big one)

### Layout (user-confirmed semantics)

The Studio gets its own layout: **no app sidebar** inside a project.

- New nested layout at `app/(private)/projects/[projectId]/layout.tsx` that
  does NOT render `AppSidebar` — requires lifting the current
  `SidebarProvider` composition so the private shell can opt out per-route
  (move sidebar rendering into a group: `(private)/(shell)/...` for
  Dashboard/Projects/Assets vs `(private)/projects/[projectId]/...` bare).
- The **AgentChatSidebar** docks on the **RIGHT**: same visual card language
  as the app sidebar, width = sidebar width + 20% (`--sidebar-width` is
  16rem → **19.2rem**). Back-to-dashboard affordance lives in the Studio
  top bar (the app sidebar is gone).
- The rest of the viewport is the FULL editor (player, timeline, panels).

### Dock ↔ sidebar: two views of ONE chat

The floating dock and the chat sidebar are the same conversation in two
states — never both visible:

- **Sidebar open → the floating dock disappears.**
- **Dock (sidebar closed)** = quick-prompt mode: the user types a fast
  instruction and sends; the message goes into the SAME per-project chat and
  the chat STAYS minimized as the dock (no auto-expand). The dock's status
  bar keeps showing the running task, as today.
- **Sending from the sidebar keeps the sidebar open** (full conversation
  view with streaming parts/tool events).
- The INPUT COMPONENT is shared: the sidebar composer is the same
  `AIDockInput` surface the dock uses — one input, two shells.
- A toggle affordance opens the sidebar from the dock (and the sidebar can
  collapse back to the dock).

### Chat semantics

- **History is per PROJECT, not per version** (user-confirmed). Versions
  are pure render outputs (§4) — conversation drives the project's evolution
  ACROSS renders; the chat log references versions ("rendered v3") as
  events instead.
- Persistence: new table `agent_messages { id, project_id, user_id, role,
  parts jsonb, created_at }` (AI SDK message-parts shape persisted verbatim;
  index on project_id+created_at; RLS tenant policy like every table).
- The agent is **generation-first**: its job is to DO things to the project,
  chat is the steering wheel. System prompt frames it as the episode's
  co-director with tool access, not a chatbot.

### Agent tools (v1 set)

| Tool | Maps to |
| --- | --- |
| `get_project_state` | project + scenes + statuses summary (read) |
| `extend_scenes({ instruction, sceneCount })` | `project.service.extend` batch |
| `retry_scene({ sceneId })` | existing scene-retry kickoff |
| `render_version()` | `version.service.render` |
| `update_languages({ audio, subtitles })` | existing update procedure |

Tool EXECUTION lives in `apps/server` (session, db, workflows). The tool
DEFINITIONS (name, description, zod input) live in `packages/ai` — the
server binds implementations at runtime (dependency injection), so the
package stays pure (§3).

### Transport

- Server route (Hono/worker route next to `/rpc`): `POST
  /agent/:projectId/chat` — AI SDK `streamText` with tools, streaming
  response (Workers support streaming). Auth: same session cookie as rpc.
- Web: AI SDK `useChat` in the AgentChatSidebar, message parts rendered with
  the existing `components/ai-elements/*` primitives (already vendored).
- Long generations don't block the stream: tools that kick workflows return
  immediately ("batch started, 3 scenes queued") and the existing
  polling/SSE keeps the editor honest — the chat is not the progress
  channel.

## 3. `packages/ai` — the AI foundations package

New workspace package. Rules-table entry:

| Package | Role | Workspace deps allowed |
| --- | --- | --- |
| `packages/ai` | AI foundations: agent definitions, prompt registry, model runtime, caches — AI SDK only, no transport/db | `types`, `env` |

Only `apps/server` may import it (same rule as `kie`/`storage`).

```
packages/ai/src/
  index.ts
  models.ts        // gateway client factory (env-only), model ids in ONE place
  cache.ts         // CacheStore interface (get/set/has, TTL) + in-memory default;
                   // server binds a KV/DO-backed store. Two layers:
                   //   - generation cache: key = hash(model + system + prompt + schema)
                   //     → skips re-billing identical agent calls (idempotent retries)
                   //   - agent runtime cache: per-project memoized context (plan,
                   //     style bible, character roster) so every chat turn doesn't
                   //     re-assemble/re-tokenize the world
  runtime.ts       // createProjectRuntime({ projectId, loaders, cache }) — the
                   // per-project runtime: lazily loads + caches project context,
                   // exposes runAgent(agent, input) with cache + telemetry hooks
  agents/
    plan.agent.ts      // moved from apps/server plan.service (system prompt builder
                       // + buildStoryPlanSchema binding)
    extend.agent.ts    // extendStory prompt + schema
    studio.agent.ts    // the chat agent: system prompt + TOOL DEFINITIONS (zod)
  prompts/
    style-bible.ts     // compileStyleBible (moved from apps/server/src/lib)
    prompt-builders.ts // keyframe/video/sheet prompt compilers (moved)
    templates.ts       // re-exports packages/types TEMPLATES seeds (single source)
```

Migration notes:
- `plan.service.ts` shrinks to orchestration: it calls
  `packages/ai` agents through the runtime; parsing/validation stays
  schema-driven (schemas remain in `packages/api` — the CONTRACT — while
  prompt text and agent wiring live in `packages/ai`).
- `lib/style-bible.ts`, `lib/prompt-builders.ts` move (pure functions, only
  depend on types) — server keeps thin re-exports during the transition so
  the workflow diff stays small; existing tests move with them.
- Model ids/env: `AI_GATEWAY_API_KEY` read via `packages/env` server bundle,
  exactly like kie.

### Scalability/cost posture

- Every agent call goes through the runtime → gets the generation cache for
  free (same prompt+schema → cached output; deliberate replay-safety on
  workflow retries WITHOUT re-billing).
- Per-project runtime = one place to add budgets later (tokens per project,
  call counters) and to swap models per agent (plan vs chat can differ).
- No package-level global state: runtimes are constructed per request/
  workflow step with injected loaders — Workers-isolate friendly.

## 4. Versions = renders (contract clarification)

Current implementation is ALREADY 90% of the target: versions are created
only by `render()` (immutable timeline snapshot + render asset), the live
timeline is project-global, and `restore()` returns a snapshot WITHOUT
mutating the project. Contract, made explicit:

- A version row = one requested FINAL RENDER (its snapshot + mp4 asset +
  status). Nothing else creates versions.
- The project timeline is the single live edit state; rendering never locks
  or forks it; multiple versions accumulate as pure history.
- `restore()` stays as an OPT-IN convenience (user-confirmed): "Load this
  cut" in the renders panel — an explicit user action, never automatic.
- History panel copy shifts to "Renders".

## 5. Generation & render audits

Two deep read-only audits are running (generation pipeline; final render
path). Findings land in this section when they complete; anything BLOCKER/
CRITICAL becomes a task before the agent work starts.

- [x] Generation pipeline audit — **completed 2026-07-12**. Findings:
  1. **BLOCKER — scene-retry forks the keyframe boundary**: retrying a scene
     with a missing start keyframe REGENERATES it even when the neighboring
     scene's end keyframe (the same conceptual K_i) already exists — visible
     jump cut between independently-retried neighbors + duplicate billed
     createTask. Extension mode already does the right thing
     (attachStartKeyframe reuse); retry must mirror it and only regenerate
     when no sibling asset exists.
  2. **CRITICAL — generation_tasks stuck PENDING on ingest failure**: kie
     succeeds (billed), then R2 ingest throws (network/putObject) → scene is
     marked failed but the task row never leaves PENDING, corrupting the
     audit/cost trail. Same class of bug fix-pass C4 fixed for poll timeouts
     — extend markGenerationTaskFailed to every non-BadResultUrlError ingest
     failure.
  3. **CRITICAL — TTS reference-audio duration guard is a no-op**:
     durationSeconds is never recorded on speech ingest, so sub-2s clips
     (short lines like "Goal!") reach Seedance and can hard-fail the WHOLE
     scene video as a non-retryable 4xx instead of degrading to
     prompt-spoken dialogue. Record real duration at ingest (parse WAV/MP3
     header) or skip reference audio below a conservative word-count.
  4. **CRITICAL (process) — zero tests on orchestration**: workflow modes,
     reuseTaskByStepKey, waitForKieTask budgets, finalizeProject recompute,
     ingest reuse-vs-fetch, kie provider bounds — all untested (existing
     suite covers only extracted pure helpers).
  5. WARNING — one runSceneRetryMode terminal branch skips finalizeProject.
  6. WARNING — retry() lacks the project-level concurrency guard extend()
     has → a retry can race a running extension batch (plausible trigger for
     finding 1).
  7. WARNING — poll steps lack kieStep's non-retryable fast-fail treatment.
  8. WARNING — no CI at all (husky = lint-staged only).
  9. INFO — poll budgets self-documented as blind-calibrated.
  Verdict: architecture sound and most documented hardening real, but NOT
  production-sound beyond the happy path until 1–3 land.
- [x] Final render path audit — **completed 2026-07-12**. Findings:
  1. **CRITICAL — export/Player duration drift** (`export.ts` vs
     `composition.tsx`): the Player hard-cuts every scene at
     `entry.durationSeconds` (Remotion `Sequence`), but the Mediabunny
     export re-encodes the FULL decoded clip and advances the mux offset by
     actual clip length — an authored duration shorter than the clip
     silently diverges from what Studio showed. This is also the exact seam
     the trim feature lands on. Fix: clamp re-encode/copy loops to
     `[0, durationSeconds]` (future `[trimStart, trimEnd]`) + test asserting
     exported duration == sum of timeline durations.
  2. **CRITICAL — `markRendered` non-terminal failures**: only the
     size-verification branch marks the version FAILED; asset-missing /
     wrong-kind / `headObject` transient errors leave it stuck RENDERING,
     blocking new renders for the 20-minute abandon window with an
     indefinite spinner. Fix: every failure path transitions version (and
     asset) to FAILED with a reason.
  3. **WARNING — client `cancel()` never reconciles the server row**: a
     canceled export leaves the RENDERING version live → immediate retry
     hits CONFLICT for up to 20 minutes. Fix: cancel() calls a server
     transition to FAILED.
  4. **BLOCKER (process) — zero tests on the whole render path** (version
     state machine, export duration/order/audio decisions, subtitle parity)
     and no CI at all (husky only runs lint-staged). Fix: unit tests for
     `render`/`markRendered` branches + export decisions; CI running
     check-types + test.
  5. Suggestions: reap orphaned PENDING render assets; surface
     `version.failReason` in the renders panel.
  Verdict: structural invariants solid (one-rendering unique index closes
  the race; `restore()` provably pure; single insert site) — confidence
  capped by #1 and #2 until fixed.

## 6. Phasing

| Phase | Scope |
| --- | --- |
| AI-1 | `packages/ai` package: move prompts/agents/schema-bindings + runtime + caches; server delegates (no behavior change, tests move too) — **done 2026-07-12** (no transitional shims — direct imports, user call; studio tools via AI SDK `tool()` with ai-agent-architect review; plan/extend routed through call-scoped runtime+cache, real per-project cache binding lands with AI-4) |
| AI-2 | Create modal (provider in providers.tsx, input-only Dialog) + global dock removal + focusNewProject rerouting | — **done 2026-07-12** (verified live: chromeless Dialog over scrim, textarea autofocus, global dock deleted) |
| AI-3 | Studio layout split (no app sidebar in project routes) + AgentChatSidebar shell (static, no agent yet) | — **done 2026-07-12** (route-group split verified with a real next build AND live: /projects keeps the shell sidebar, /projects/[id] renders bare with the chat shell; dock↔sidebar exclusivity via StudioChatProvider, synced motion handoff). Known follow-up: typedRoutes + clean checkout needs a next build before web check-types (.next/types) |
| AI-4 | `agent_messages` table + chat endpoint (streamText + tools) + useChat wiring + v1 toolset — **done 2026-07-12** (migration 0008 applied; verified live server-side: 401 unauthenticated, 404 foreign project before any persistence/model call, SSE stream opens and surfaces errors gracefully; full happy path blocked on a real `AI_GATEWAY_API_KEY` in the running worker). Deviations: history is client-fetched (layout sits above the page's HydrationBoundary), `@ai-sdk/provider` added to catalog for portable `streamText` types |
| AI-5 | Audit remediations (from §5) — sequenced by severity, may run before/parallel to AI-2+ |
| AI-6 | Post-AI-4 remediation + agent polish (see §8) — review findings (risk + reliability lenses), duration prompt guidance, prompt-chain upgrades |

### AI-5 remediation batch (launched 2026-07-12)

Generation: GEN-1 keyframe reuse in retry (+ test), GEN-2 mark task failed
on ingest errors (+ test), GEN-3 speech duration recorded at ingest + guard
activation (+ test), GEN-5 finalizeProject on the skipped retry branch,
GEN-6 project-level guard on retry(), GEN-7 poll-step fast-fail parity.
Render: REN-1 export clamps every scene to durationSeconds (+ duration-sum
test), REN-2 markRendered failure paths always terminal (+ state-machine
tests), REN-3 cancel() reconciles the server row (versions.cancel or
equivalent). Process (user call: no CI workflow): the gate lives in husky instead —
.husky/pre-commit runs lint-staged, then `bun run check-types`, then
`bun run test`; any failure blocks the commit.

**Batch landed 2026-07-12** — all GEN/REN items fixed with 54 new tests
(keyframe-reuse 5, ingest-failure 5, audio-duration 24, mark-rendered 9,
export-trim-window 11); suite now 231 tests across 5 packages, all green.
Post-batch correction: retry()'s project guard allows TERMINAL statuses
(ready OR failed) — failed-project scene retry is the recovery path; only
non-terminal (running workflow) blocks.

Dependencies: AI-1 first (foundations), AI-2 independent, AI-3 → AI-4.
`scenes-architecture-v3.md` Phase B (position/trim) can interleave — it
touches the editor, not the agent surface.

## 7. Open questions

- Chat agent model: same gateway model as plan agent v1; revisit if chat
  latency matters (smaller model for chat, big model for plan).
- Rate limiting agent tool calls: reuse MAX_GENERATION_KICKS_PER_HOUR (tools
  funnel into the same services, so limits apply automatically — verified
  2026-07-12: extend/retry enforce it inside the services; render/languages
  unrated, matching their oRPC counterparts).
- agent_messages retention: unbounded per project for now; cap later.

## 8. AI-6 — post-AI-4 findings & agent polish (audited 2026-07-12)

Sources: review-risk + review-reliability lenses on the AI-4 diff, live
server-side E2E, prompt-chain audit, subtitle/voice/video sync audit.

### 8a. Chat endpoint fixes (from reviews + live repro)

1. BLOCKER — zero tests for the whole AI-4 feature (service, repository,
   route, tools). Add unit/integration tests with `streamText`/`gatewayModel`
   mocked; no E2E framework needed.
2. CRITICAL — error turns persist garbage (live-reproduced with the gateway
   key missing): the user row commits before `streamText`, and `onFinish`
   persists an assistant row with EMPTY `parts: []` on stream error. Fix:
   don't persist empty assistant turns; persist an error marker part instead
   (UI renders a retry affordance), or roll back the user row on pre-stream
   failures. AI-6a landed: skip + `console.error`-log only (no error-marker
   part, no user-row rollback) — simpler, and the incoming user turn staying
   persisted is correct either way (retrying the same prompt should not
   require re-typing it).
3. CRITICAL — double-submit: sidebar composer (`AgentChatComposer`) has no
   `status` guard (dock has one). Two concurrent POSTs → duplicate user rows
   + two concurrent agent turns on the same project. Fix: gate on
   `status === "submitted" || "streaming"` in the shared input, plus a
   server-side in-flight guard per (project) if cheap.
4. CRITICAL — history backfill: if the user sends before `useAgentHistory`
   resolves, the `messages.length === 0` guard permanently skips backfill
   (prior turns hidden) AND the server trusts the client `messages` array
   (never re-merges persisted history) so the model also loses context. Fix:
   merge-by-id backfill on the client; server prepends persisted history
   (dedup by message id) before `convertToModelMessages`.
5. WARNING — no rate limit / body bound on the chat route itself (paid LLM
   call). Every other paid action is throttled. Fix: per-user hourly cap +
   max messages length / content-length bound, mirroring the kie webhook's
   bound.
6. MAJOR — dock quick-prompt feedback regression: `projects.get` invalidates
   only in `onFinish` (after the full ≤6-step turn), old extend flow
   invalidated immediately. Fix: invalidate on tool-result parts as they
   stream (onData/onToolCall), not just onFinish. AI-6a landed: an effect
   over `useChat`'s `messages` (not `onData`/`onToolCall`) — verified against
   the installed ai@7.0.22 types that `onData` only fires for custom
   `data-*` UI parts, never tool-call/result parts, so it can't see a
   `tool-extend_scenes` output landing; `onToolCall` fires at tool-CALL time,
   before the result exists. Watching `messages` for a mutating tool part
   reaching `output-available` (deduped per `toolCallId`) is the correct
   AI SDK v7 mechanism for this.
7. Minor: secondary sort key (id) on history ordering; zod-validate the raw
   chat body at the route boundary.

### 8b. Toolset (v1 confirmed + one addition)

Keep the lean five: `get_project_state`, `extend_scenes`, `retry_scene`,
`render_version`, `update_languages`. Story brainstorming is NOT a tool —
it's the system prompt + project state (the agent proposes, then calls
`extend_scenes` on user confirmation).

- UPGRADE `get_project_state`: today it returns only title/synopsis/status +
  scene id/title/status — the "co-director" can't see dialogue, prompts, or
  characters, so its creative advice is unguided. Return scene
  title/prompt/dialogue/speaker/duration + plan characters (name, role,
  visualDescription 1-liner). This unlocks user ask #2 (continue the story
  coherently) with zero new tools.

### 8c. Scene duration (user ask — mostly already built)

`durationSeconds` already flows agent → schema (int 4–15, zod) → scenes row →
kie `duration` param → player/export clamp. kie Seedance 2.0 mini accepts
integer 4–15s (docs/video-engine-architecture.md §3; adapter validates it).
Missing pieces only:

1. Prompt guidance in plan + extend agents: choose duration per beat — short
   (4–6s) single impacts, mid (8–10s) dialogue/action (≥ words/2.5 + 1s air),
   long (12–15s) held emotional beats; vary across the episode; state the
   allowed range in prose (today it's schema-only).
2. Expose the range as `packages/types` constants already used by schemas
   (MIN/MAX_SCENE_DURATION_SECONDS exist) — no discrete-set restriction
   needed unless the provider rejects values (it doesn't per current docs).
3. Guard: editing durationSeconds after `video_ready` doesn't regenerate the
   clip (lengthening yields dead time). Any duration-edit UI must gate on
   pre-generation status or trigger a retry.

### 8d. Prompt-chain upgrades (creative direction for lazy briefs)

HIGH: (1) extend agent can't spec new characters/locations — server
fabricates placeholder descriptions that seed REAL binding character sheets
(off-design forever). Add optional `newCharacters[]`/`newLocation` to the
extend schema + prompt line. (2) No premise-expansion directive — user's
one-liner goes in verbatim and templates fight it ("Japanese names",
"single match moment" can normalize away "messi bribes the ref"). Add: user
premise is sacred, expand never replace, only invent names the user didn't
give. (2b) Real-person detection (user call 2026-07-12): when the brief
names a real/famous person, the agent must cast THEM as a character — keep
the real name, write a visualDescription of their recognizable likeness in
the anime style (kit, build, hair, iconic traits), never swap them for an
invented character. Applies to plan AND extend. (3) Template act-structure
is hardcoded 3-beat but sceneCount is 1–10 — make beat guidance count-aware.

MEDIUM: duration direction (8c.1); extend agent context too thin (add
synopsis + previous scene's cinematography); `joinPromptSections` drops the
consistency clause FIRST on overflow (it's last, and max-bounds overflow the
6000 cap — reorder priority); no textual fallback for missing character
sheets (append visualDescription when sheet URL absent).

LOW: studio agent state visibility (8b); K_{N+1} borrows last scene context;
Japanese dialogue wps calibration; retry cinematography fallback duplicates
prompt as motionNotes.

### 8e. Subtitle/voice/video sync (audited verdict)

Voice↔video CANNOT desync in our code: TTS is handed to Seedance as
`reference_audio_urls` and comes back baked into the clip; export copies the
clip's own audio; preview/export timing math is provably identical (integer
seconds × 30fps, shared trim windows). Caveats to fix:

1. Subtitles are scene-granularity (one caption for the whole scene) — no
   speech-onset tracking; fine for v1, needs word timestamps for per-line.
2. STALE-SUBTITLE BUG: `scenes.update` allows editing dialogue/subtitleText
   after `video_ready` with no invalidation — burned subtitle can contradict
   baked audio. Fix: flag scene stale or gate the edit.
3. LATENT TRIM BUG (Phase B blocker): `isBeforeTrimWindow` is exported +
   tested but NEVER imported by export.ts — a nonzero trimStart would mux
   pre-trim samples negative-shifted into the previous scene. Fix before
   Phase B: add the skip to copyAudioScene/reencodeVideoScene/
   reencodeAudioScene.
4. Zero tests on the export mux loop itself (offset accumulation, rebasing);
   most valuable missing test: synthetic scenes with over/under-length clips
   asserting output timestamps vs Remotion frame math.

### 8f. Env blocker

`AI_GATEWAY_API_KEY` is not set in the running worker — every agent feature
(plan, extend, studio chat) fails at the gateway. Needs a real key before any
E2E of the happy path. QA fixtures left in dev DB for post-fix verification:
user agent-chat-qa@example.com, project `jy70933bbanhlpptisdw3gu5` (2 scenes,
ready).

### AI-6a landed 2026-07-12

Shipped: 8a fixes 1-7 (empty-assistant-turn skip + logged, `onError`
server-logs/generic-client-message, server-side history merge capped to the
last 30 messages, client merge-by-id backfill with a ref "applied once"
guard, shared `isChatWorking` double-submit guard for both dock and sidebar
composers, `MAX_AGENT_TURNS_PER_HOUR` (30) rate limit + 128KB body bound +
zod boundary schema on the chat route, `(createdAt, id)` history ordering);
8b `get_project_state` upgrade (title/synopsis/status/languages, plan
characters, timeline-ordered scenes with dialogue/prompt/failReason, capped);
8c/8d duration-direction + real-person-casting + premise-fidelity + count-
aware-beat prompt guidance (plan + extend agents, all 8 templates), extend
schema `newCharacters`/`newLocation` + server consumption (fabricated-
placeholder path now a logged fallback only — the existing per-scene sheet-
generation loop in `video-generation.ts` already keys off `sheetAssetId`
nullness regardless of origin, so no workflow change was needed), extend
context now includes synopsis + the last scene's cinematography, prompt-
builders consistency-clause reorder (style block → clause → content, both
builders) + sheetless-character textual fallback; 8e stale-dialogue/duration
CONFLICT guard on `scenes.update` (subtitleText/prompt stay editable) +
`isBeforeTrimWindow` wired into all three export mux loops (byte-identical
output today, since `trimStart` is always 0 — closes the latent Phase B bug).

Deviations from the AI-6a task brief (with why): `STUDIO_AGENT_MODEL`
("openai/gpt-5.6-terra") is now passed explicitly to `gatewayModel()` in
`buildStudioChat` — a scope addition mid-batch (models.ts already carried
the constant) tying the chat agent to its own model instead of silently
inheriting `PLAN_AGENT_MODEL`'s default. `packages/api` gained a `test`
script + `@types/bun`/tsconfig `types` entry (it had zero test
infrastructure before this batch) so `extendStorySceneSchema`'s new fields
could be unit-tested per package-boundary convention (mirrors
`packages/ai`/`packages/kie`/`packages/db`'s own `bun test` setup) rather
than testing an api-package schema from inside apps/server.

Deliberately NOT done (out of this batch's scope, still open per 8d LOW /
8e items above): K_{N+1}'s "borrows last scene's context" simplification,
Japanese dialogue wps calibration, retry's cinematography-fallback
duplicating the prompt into motionNotes, per-line subtitle timestamps, and
new tests on the export mux loop's offset/rebasing math beyond the
`isBeforeTrimWindow` pure-helper coverage that already existed.

### AI-6b — evals (landed 2026-07-12)

A real eval suite for the three agents, under `packages/ai/evals/` on
[evalite](https://evalite.dev) (run: `cd packages/ai && bun run eval`, watch
UI: `bun run eval:watch`). **Deliberately NOT wired into turbo's
test/check-types pipelines** — every row is a paid gateway call (the plan
suite alone runs 7 generations up to 10 scenes plus ~19 judge calls), so
evals run only on demand. The key loads from `apps/server/.env` via
`evals/setup.ts` (shell env always wins).

Three suites:

- **`plan-agent.eval.ts`** — the REAL `runPlanAgent` path (exact
  `buildPlanSystemPrompt` composition + `buildStoryPlanSchema(sceneCount)`
  guardrail, `PLAN_AGENT_MODEL`) over 7 fixtures: real-person briefs (Messi,
  LeBron), a user-named fictional boxer, an emotional-spine brief, a Spanish
  brief with `ja` audio, a degenerate 3-word brief at the 1-scene edge, and
  a 10-scene long-arc edge. Deterministic scorers (`duration-variety`,
  `dialogue-budget`, `speaker-validity`, `shot-variety`,
  `premise-retention`, `dialogue-language`) + judges (`premise-fidelity`,
  `story-craft`, `real-person-casting`).
- **`extend-agent.eval.ts`** — the REAL `runExtendAgent` over the
  `fixtures/story-sofia.ts` story-so-far (composed field-for-field like
  `runExtensionPlanStep`, including the compiled style bible via the real
  `compileStyleBible` and the §8d synopsis/cinematography context); a
  2-scene batch threads context sequentially like the production workflow
  loop. Cases: pure continuation (no new characters allowed) and a
  new-character instruction (`new-character-specced` checks the full
  `newCharacters` spec + actual on-screen use); judge:
  `continuation-coherence`.
- **`studio-tool-routing.eval.ts`** — single-step `generateText` with the
  production system prompt (`STUDIO_AGENT_SYSTEM_PROMPT` + the REAL state
  block — `formatProjectState` moved into `packages/ai/src/prompts/
  project-state.ts` this phase so eval and server share it) and the real
  no-execute tool definitions, `STUDIO_AGENT_MODEL`. Six routing cases
  (extend with count, status question, render, language switch, retry of
  the failed scene by opaque id, social turn) scored by a deterministic
  `tool-routing` scorer (mutating tool where none expected = 0).

Judge-model rationale: judges run `EVAL_JUDGE_MODEL`
("openai/gpt-5.6-terra") — deliberately a DIFFERENT model family than the
sonnet-5 plan/extend generator, to avoid same-model self-preference bias.
Model ids were split into `packages/ai/src/model-ids.ts` (pure constants,
no imports) because `models.ts` imports env via `cloudflare:workers`, which
cannot load under node/vitest; `models.ts` re-exports them unchanged.
Scorer skip convention: evalite has no per-row scorer opt-out, so a scorer
that doesn't apply to a fixture returns 1 with `{ skipped: true }` metadata
(neutral pass) — read scores together with metadata. Failure convention:
plan/extend tasks mirror plan.service.ts's single application-level retry;
a row that fails BOTH attempts (e.g. a schema-violating generation) scores
0 on every scorer with `{ generationFailed, error }` metadata instead of
throwing — a prompt/schema regression tanks the average visibly, and the
rest of the table survives (thrown task errors also trip an evalite 0.19 +
vitest 4 reporter crash that would eat the whole run's rendering).

### AI-6a review remediation landed 2026-07-12

Fixed the confirmed AI-6a review findings: `buildStudioChat`'s rate-limit
count + user-message insert now run inside ONE `withUser` transaction,
serialized per project via `projectRepository.findByIdForUpdate`'s row lock
(`lib/agent-chat-turn.ts::runAgentTurnTx`, same lock pattern as
`project.service.ts::extend`) — closes a TOCTOU where two concurrent turns
could both read a below-cap count before either insert committed. Extracted
two previously-untested pure mappings into bun-testable `lib/` modules with
new coverage: `buildProjectStateForTool` (`lib/project-state-for-tool.ts` —
timeline ordering, 200/240-char truncation boundaries, failReason-only-on-
failed) and the `runExtensionPlanStep` newCharacters/newLocation merge
(`lib/extension-plan-merge.ts` — spec-then-placeholder-fallback precedence,
existing-wins-on-collision). Added a `key={projectId}` remount guard to the
Studio layout's `StudioChatProvider` (App Router layouts don't remount on
dynamic-segment changes) and a cap-vs-genuinely-new-message test to
`lib/agent-chat-turn.test.ts`.
