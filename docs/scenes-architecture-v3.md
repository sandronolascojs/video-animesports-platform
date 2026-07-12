# Scenes v3 — batch generation, story continuity, live timeline

Status: **agreed direction** (2026-07-11). This doc is the single source of
truth for the scenes/generation rework so implementation doesn't drift.
Supersedes the parts of `video-engine-architecture.md` it contradicts
(notably `draft_timeline` as ordering authority).

## Product vision (what we're building)

1. **One prompt → a full episode.** The user tells a complete story in the
   composer ("Messi remembers a goal scored against him; a military man walks
   in from the locker rooms with a briefcase full of money; he tells the
   referee to fix the match for Argentina…"), picks the scene count (default
   3, up to 10), and the plan agent generates EVERYTHING the episode needs:
   every character mentioned or implied (with visual specs and gender), every
   location, the full script (scene prompts, dialogue, subtitles, keyframe
   chain, cinematography).

2. **The story continues in the Studio.** Editing is conversational: the user
   types "add a scene where the goalkeeper crashes into the post and gets
   knocked out", picks how many scenes (1–10), and the extend agent continues
   FROM THE CURRENT STORY — the story-so-far context is the CURRENT timeline
   state (deletions included: if scenes were removed, the agent never sees
   them), plus the existing characters/locations/style bible so it stays
   in-world and in-style. New scenes append to the timeline by position.

3. **The timeline is alive.** The moment a generation batch is requested,
   placeholder items appear in the Studio timeline (loading state). As each
   scene's assets finish rendering, the timeline item updates in place with
   its mini preview — pushed to the client (SSE), not manually refreshed.

4. **Voices are cast per character.** Each plan character carries a `gender`;
   its ElevenLabs voice is drawn from the per-language, per-gender pool
   (`VOICE_POOLS`) deterministically — `hash(projectId:characterName)` — so
   the voice is FIXED for that character across every scene and re-run.
   Dialogue language and subtitle language come from the composer selectors
   and bind the agent's output languages (already enforced in the plan
   system prompt).

## Data model (target)

### `scenes.position` becomes the ordering authority

- Add `position: integer NOT NULL` to `scenes` (project-scoped ordering,
  1..N; renumber-in-transaction on reorder — trivially cheap at ≤ dozens of
  scenes per project).
- **Drop `projects.draft_timeline` as authority.** The timeline is DERIVED:
  `scenes WHERE project_id ORDER BY position`. Its duplicated fields already
  live on the scene (`durationSeconds`, `videoAssetId`) — the jsonb copy and
  its backfill machinery go away. One source of truth, no drift.
- Migration: backfill `position` from the current `draft_timeline` order,
  then remove timeline writes; keep the column readable until the cutover
  lands, then drop it.

### Scene ↔ assets

- Today: four NAMED slots on the scene (`startKeyframeAssetId`,
  `endKeyframeAssetId`, `videoAssetId`, `audioAssetId`). Keyframes are
  already shared between neighboring scenes (same asset id in two slots) —
  the real relation is many-to-many with roles.
- Characters/locations are project-level assets (`character_sheet`,
  `location_sheet` hang off the project; scenes reference them by
  name/key through the plan).
- **Phase 2 (deliberate deferral):** a `scene_assets { scene_id, asset_id,
  role, created_at }` join table (UNIQUE(scene_id, role) while single-take)
  replaces the named slots when the product needs multiple takes per role
  (retry history, take picking) or per-scene character/location links as
  rows. The named slots are rigid but explicit and the whole generation
  pipeline reads them — migrating before there's a takes feature buys
  nothing.

### Plan / characters

- `plan.characters[]` gains `gender` (`male | female`) — voice casting axis.
- `scenes.speaker_name` (nullable, ALREADY migrated — 0007): the ONE plan
  character delivering the scene's dialogue; null for silent scenes.
- Character cap rises with story ambition: `max(10)` characters in the plan
  schema (was 8). Cast-per-frame cap (≤3) stays.

## Generation (target)

### Scene count is a per-batch input

- `MIN_SCENES_PER_GENERATION = 1`, `MAX_SCENES_PER_GENERATION = 10`,
  default `INITIAL_SCENE_COUNT = 3`.
- `projects.create` takes `sceneCount` → inserts N placeholder scenes
  (positions 1..N). The plan agent's schema is a factory
  (`buildStoryPlanSchema(sceneCount)`) — exact scene count and exact N+1
  keyframe chain stay hard zod bounds.
- `projects.extend` takes `prompt + sceneCount` → inserts N placeholders at
  positions tail+1..tail+N.

### One workflow per batch (fixes a real race)

- Today each extension kicks its own workflow; two parallel extensions would
  both chain "from the last keyframe" and fork the keyframe chain.
- Target: `SCENE_EXTENSION` (and initial generation) receive `sceneIds[]`
  and process the batch **sequentially inside one workflow instance** —
  extend agent → keyframes → video → speech per scene, chaining K(i) → K(i+1)
  within the instance. The chain is correct by construction.

### Extend-agent context contract

Every extension call receives:
- The CURRENT story state: title, synopsis, style bible spec, characters
  (with genders), locations, and the ordered CURRENT scenes
  (title/prompt/dialogue per position — deleted scenes simply aren't there).
- The last keyframe description (the chain anchor).
- The user's instruction ("add a scene where…") and how many scenes to add.

The agent may introduce NEW characters/locations when the instruction needs
them (the military man with the briefcase) — new entries merge into
`plan.characters` / `plan.locations` and get their sheets generated before
the scene renders, same as the initial flow.

## API surface

- `createProjectInputSchema` + `sceneCount` (done).
- `extendProjectInputSchema` + `sceneCount` (done — semantics: batch size).
- Story schemas: `characters[].gender`, `scenes[].speaker`,
  `buildStoryPlanSchema(n)` (done).
- `scenes` output schema carries `speakerName` (done) and will carry
  `position`.

## Studio UI + realtime

- **Composer selectors everywhere**: aspect/voice/subtitles + the scenes
  dropdown (1..10, default 3) in the Home composer, the global dock, and the
  Studio dock (extension batch size).
- **Global AI dock**: the floating PromptDock lives on every private route;
  "New project" buttons focus it (Home focuses its hero composer; Studio
  keeps its own dock).
- **Pending scenes render as loading tiles** in the storyboard/timeline the
  moment the batch is created (placeholder rows exist immediately, status
  `planned` → `keyframe_pending` → …).
- **Push updates**: SSE endpoint on the server app (Workers support
  streaming responses) — `GET /events/projects/:id` emits scene/asset status
  transitions; the Studio subscribes and patches the react-query cache, so a
  finished clip pops into its timeline slot with its mini preview without a
  manual refresh. Fallback (and v1 today): the existing `projects.get`
  polling. SSE is additive — same events, faster paint.

## Phasing

| Phase | Scope | Status |
| --- | --- | --- |
| A | Voice casting (gender, speaker, pools, deterministic pick) + sceneCount inputs + scenes dropdown UI + global dock + extension batching (C-lite) | **done** (2026-07-12) |
| B | `scenes.position` cutover (migration + derive timeline + delete backfills) | next |
| C | Batch workflows (`sceneIds[]`, sequential chain) + extend-agent current-story context | with B |
| D | SSE push for scene/asset status (polling stays as fallback) | after B/C |
| E | `scene_assets` join table with roles (multi-take support) | when takes feature lands |

## Timeline editing (Studio) — trim/resize requirement

Scenes must be CUTTABLE in the Studio timeline: the user can trim a scene's
clip (shorten it, adjust where it starts/ends) without regenerating. This
constrains Phase B's data model:

- Trim state lives ON the scene row, not in a timeline jsonb: add
  `trimStartSeconds` (default 0) and `trimEndSeconds` (nullable = clip end)
  alongside the existing `durationSeconds` (the GENERATED length). The
  effective playback length is `min(trimEnd ?? duration, duration) -
  trimStart`.
- The Player composition, the Mediabunny export, and burned subtitles all
  read the effective (trimmed) window — the export cuts the source clip to
  the trim range.
- Trimming never mutates the asset: the mp4 in R2 stays full-length; trim is
  non-destructive edit state (so the user can extend the cut back out).
- UI: timeline clip edges become drag handles (the timeline already has
  ruler/zoom/scrub machinery to snap against).

Lands with Phase B (same migration adds `position`, `trim_start_seconds`,
`trim_end_seconds`).

## Deferred refactors

- [done 2026-07-12] `PromptDock` family renamed to `AIDock` family
  (`components/kit/ai-dock/`: `AIDock`, `AIDockInput`, `AIDockPill`,
  `AIDockStatusBar`) — files, components, prop types, barrel and every
  import site.

## Open questions

- Deleting a scene mid-chain leaves K(i)/K(i+1) anchors of its neighbors
  intact but the VISUAL chain skips a beat — acceptable for now (edit
  freedom wins); revisit if continuity complaints appear.
- Extension batches >5 scenes: cost guardrail (each scene = keyframe + video
  + possible TTS kie tasks). Rate limiter already caps kicks/hour; keep 10 as
  UI max but surface expected cost in the UI later.

---

# Gap analysis & implementation checklist (2026-07-11)

Everything below is written against the CURRENT code. Items marked `[done]`
already landed while this doc was being drafted.

## Already landed

- [done] `CharacterGender` enum (`packages/types/src/enums.ts`).
- [done] `VOICE_POOLS` + `pickCharacterVoice` (deterministic djb2 hash) +
  `MIN/MAX_SCENES_PER_GENERATION` (`packages/types/src/constants.ts`) —
  NOTE: MAX currently 5, must become **10** (task A1).
- [done] `scenes.speaker_name` column (migration 0007, applied to Neon).
- [done] `ProjectPlanCharacter.gender?` (`packages/types/src/shapes.ts`).
- [done] Story schemas: `characters[].gender`, `scenes[].speaker`,
  `buildStoryPlanSchema(sceneCount)` factory
  (`packages/api/src/schemas/story.ts`); `sceneSchema.speakerName`
  (`schemas/scene.ts`); `createProjectInputSchema.sceneCount` +
  `extendProjectInputSchema.sceneCount` (`schemas/project.ts`).
- [done] `generation.service.ts`: plan→ProjectPlan persists `gender`;
  initial + extension scene backfills persist `speakerName`.

## Phase A tail — tasks for implementation

### A1 — constants & caps (`packages/types`, `packages/api`)
- `MAX_SCENES_PER_GENERATION`: 5 → **10**.
- Plan schema character cap: `characters: z.array(...).min(1).max(8)` →
  `.max(10)` (`packages/api/src/schemas/story.ts`).

### A2 — plan agent prompts (`apps/server/src/services/plan.service.ts`)
- `callPlanAgent` must validate with the factory:
  `Output.object({ schema: buildStoryPlanSchema(input.sceneCount) })`
  (currently the fixed `storyPlanSchema`).
- Add these two lines to `buildPlanSystemPrompt` (verbatim, after the
  "characterNames … locationKey" cross-reference rule):
  - `'Every character carries a "gender" — "male" or "female" — used to cast that character\'s voice actor; decide it from the story and never leave it ambiguous.'`
  - `'Every scene whose "dialogue" is non-empty names its "speaker": EXACTLY ONE name from your "characters" array — the single character heard saying the line. Silent scenes (empty dialogue) set "speaker" to null. One voice per scene: never write a line that two characters deliver together.'`
- The extendStory system prompt (same file, extension section) gets the SAME
  two lines, adapted to its context (it already receives existing
  characters; if the user's instruction requires a NEW character, the agent
  may add one — see A4).

### A3 — speech voice casting (`apps/server/src/services/generation.service.ts`)
- `generateSceneSpeech` gains a `characters: ProjectPlanCharacter[]` arg
  (callers pass `project.plan?.characters ?? []` — the workflow already
  loads the project for `audioLanguage`; thread the plan characters the same
  way).
- Voice resolution replaces the flat lookup:
  ```ts
  const speaker = args.scene.speakerName;
  const character = speaker
      ? args.characters.find((c) => c.name === speaker)
      : undefined;
  const voiceId = character?.gender
      ? pickCharacterVoice({
              projectId: args.projectId,
              characterName: character.name,
              gender: character.gender,
              language: args.audioLanguage,
          })
      : TTS_VOICE_BY_LANGUAGE[args.audioLanguage];
  ```
- Import `pickCharacterVoice` from `@video-platform-challenge/types`.

### A4 — extension batching, C-lite (`project.service.ts`, `generation.service.ts`, `workflows/video-generation.ts`)
- `VideoGenerationWorkflowParams`: add `sceneIds?: string[]` (keep `sceneId`
  for back-compat; normalize `const sceneIds = params.sceneIds ?? (params.sceneId ? [params.sceneId] : [])`).
- `project.service.extend()`: honor `sceneCount` — insert N placeholder
  scene rows (loop the existing insert, appending N timeline entries), then
  kick ONE workflow via `startSceneExtension(projectId, sceneIds, userId)`.
- `generation.service.startSceneExtension`: signature takes `sceneIds:
  string[]`; passes them in workflow params.
- Workflow `SCENE_EXTENSION` branch: iterate `sceneIds` SEQUENTIALLY,
  running the existing single-scene extension routine (extendStory agent →
  keyframe → video → speech) per id, in order — each iteration chains from
  the keyframe state the previous one left. Do NOT parallelize; the
  sequential order IS the keyframe-chain correctness guarantee.
- If the extendStory agent output introduces a character/location name not
  in the plan, merge it into `projects.plan.characters/locations` (with its
  `gender`) and generate its sheet before that scene's keyframes — reuse the
  initial flow's sheet-generation step for just the new entries.

### A5 — web: scenes dropdown (`apps/web`)
- `ComposerToolbar` (`feature/home/components/composer-toolbar.tsx`): add a
  `sceneCount` selector — same visual language as the existing selectors
  (icon + value + chevron), options 1..10 rendered as "N scenes", default 3.
  New props `sceneCount: number; onSceneCountChange: (n: number) => void`.
- Home composer form (`feature/home/views/home-view.tsx`): add
  `sceneCount: INITIAL_SCENE_COUNT` to `useForm` defaultValues (this also
  fixes the currently-failing Resolver type error) and wire the toolbar
  props from `watch("sceneCount")`/`setValue`.
- Studio dock: the Studio's PromptDock `leftToolbar` gains the same
  selector; `useExtendProject` mutation call passes `sceneCount`.

### A6 — web: global AI dock (`apps/web`)
- New `components/kit/create-dock.tsx`: `CreateDockProvider` (client) mounted
  in `(private)/layout.tsx` INSIDE the existing providers, exposing
  `useCreateDock(): { focusNewProject(): void }`.
- The provider renders a floating `PromptDock` bound to a create-project
  form (same fields/submit as Home's: shared `createProjectInputSchema`,
  `useCreateProject`, on success `router.push(/projects/{id})`) on every
  private route EXCEPT `/` (Home owns its composer+dock) and
  `/projects/[projectId]` (Studio owns its dock) — gate with `usePathname()`.
- `focusNewProject()` behavior by route: on `/` → dispatch
  `window.dispatchEvent(new CustomEvent("zenkai:focus-composer"))` (HomeView
  adds a listener that bumps its existing `focusSignal`); on Studio →
  `router.push("/")`; elsewhere → expand + focus the global dock
  (`AIDock` (formerly PromptDock) has optional `openSignal?: number` and `focusSignal?:
  number` pass-through props to its `DockInput`).
- Sidebar `NewProjectPill` (`components/app-sidebar.tsx`): `<Link href="/">`
  → `<button onClick={focusNewProject}>` (keep the exact pill styling/kbd).

### A7 — checks
- `bun run check-types` green across the 9 packages; biome clean on touched
  files. NO db:generate needed (no schema change in A beyond the already-
  applied 0007).

## Phase A post-review fixes (2026-07-12, applied)

- BLOCKER fixed: `runSceneExtensionMode` no longer early-returns on a
  per-scene abort — project-gone aborts the run, scene-gone skips and
  continues, and `finalizeProject` always runs exactly once after the loop
  (the project can never be stranded in `generating`).
- CRITICAL fixed: extension sheet step names (and their kie idempotency
  stepKeys) are suffixed with the driving `sceneId`, so a second batch scene
  referencing the same unresolved character/location retries instead of
  replaying the first scene's cached failed step.
- Tests added (bun:test): `packages/types/src/constants.test.ts`
  (pickCharacterVoice determinism/pools/fallback) and
  `apps/server/src/lib/scene-voice.{ts,test.ts}` — voice resolution
  extracted as pure `resolveSceneVoice` (generation.service can't load under
  plain bun test, lib/ is the repo's testability pattern).
- Suite: types 4 / db 5 / kie 27 / server 106 — all green.

## Phase B/C — next batch (NOT in this implementation round)
- B: `scenes.position` migration + backfill from `draft_timeline` order;
  repositories expose ordered reads; timeline derived; delete
  `updateDraftTimeline` write path + web draft-store timeline authority +
  version pinning reads (13 call sites across `generation.service` (8),
  `project.service` (6), `scene.service` (3), `version.service`,
  `workflows/video-generation.ts` (3), web `draft-store.ts`).
- C-full: initial-generation workflow also takes `sceneIds[]` explicitly;
  retire the `sceneId` singular param.
- D: SSE endpoint + Studio subscription.
