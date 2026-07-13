# Anime-quality recovery + clip coherence — decision record

Owner call 2026-07-12. Covers the "quality dropped + physics/coherence" report.

## Problems

1. **Anime look regressed** (colors darker, off-style vs the first good generation).
   Root cause: `PLAN_AGENT_MODEL` was swapped `claude-sonnet-5 → gpt-5.6-terra`. The plan
   agent authors the ENTIRE style bible (artDirection, colorScript, lighting) prepended to
   every image/video prompt — so the model IS the show's visual identity.
2. **Physics / coherence**, two distinct failures that were conflated:
   - **Within-clip physics** ("player next to the goal strikes as if from midfield").
     Cause: the scene's keyframes and/or its action beat describe incompatible positions,
     so seedance invents impossible motion to reconcile them.
   - **Clip-join drift** (a cut that doesn't flow between consecutive clips).

## Fixes applied — all prompt-level, zero infra, runs local

- `model-ids.ts`: `PLAN_AGENT_MODEL` → `anthropic/claude-sonnet-5`; eval judge → `gpt-5.6-terra`
  (keep a different family than the generator).
- `plan.agent.ts`:
  - `colorScript` → BRIGHT/vivid Crunchyroll, high-key, no desaturate/darken-for-mood.
  - `lighting` → favor bright, well-lit setups.
  - scene action must be **physically achievable between its own two bounding keyframes**
    (Kᵢ→Kᵢ₊₁) — never an action bigger than that gap; bigger actions span more scenes.
- `prompt-builders.ts` (`buildSceneVideoPrompt`): physical-logic clause — motion obeys the
  first frame's positions/momentum; no teleporting; real weight, planted feet.
- (already present) `story-direction.ts`: `SCENE_CONTINUITY_DIRECTIVE` +
  `KEYFRAME_CHAIN_CONTINUITY_DIRECTIVE` + short-duration bias.

## Why we do NOT extract the real last frame (rejected, with evidence)

The idea "use V_i's real last frame as V_{i+1}'s first frame" needs a video→frame extractor
inside a Cloudflare Workflow step. Every option is blocked or rejected:

- **CF Media Transformations `env.MEDIA` binding** — the right tool, but **alchemy does not
  model it** (not in the `Binding` union, not in the v2 docs, and alchemy's miniflare dev
  builder `assertNever`s any unknown binding — verified in
  `build-worker-options.ts`). Also `env.MEDIA` has no local simulation (needs `remote=true`).
- **URL form `/cdn-cgi/media/mode=frame`** — needs a CF zone with Media Transformations
  enabled + a HEAD/range-capable source. We have workers.dev (no `/cdn-cgi/media/`) and a
  private R2 (signed GET only, `devDomain:false`). Would require a custom domain. Rejected.
- **ffmpeg.wasm / any WASM decoder in the Worker** — workerd blocks runtime WASM compilation
  (like `eval()`), has no Web Workers/threads/SharedArrayBuffer, and the ~31MB core blows the
  10MB bundle + 128MB isolate caps. Dies at startup.
- **Node compat** — `nodejs_compat` is polyfills, not a machine: no syscalls, no filesystem,
  `child_process` is a non-functional stub; cannot run a native encoder. CF's own words:
  "does not turn an isolate into a machine that can run a video encoder."
- **Separate micro-worker / container / task-runner with ffmpeg** — works, but rejected by
  owner as wasteful for a single frame per scene.

## The chosen approach — source coherence (better, not a fallback)

The pipeline ALREADY chains clips through a **shared boundary keyframe**: scene i ends on
Kᵢ₊₁ and scene i+1 starts on Kᵢ₊₁ (the same still). Continuity between clips already exists.
The real fix is to make that boundary coherent at the SOURCE:

- The clean gpt-image-2 boundary keyframe is a **higher-quality anchor** than a motion-blurred
  real video frame — starting the next scene from it looks *better*, not worse.
- Make the keyframe chain physically-consecutive (KEYFRAME_CHAIN_CONTINUITY_DIRECTIVE) and the
  scene action achievable within its two keyframes → natural within-clip motion + smooth joins.
- Keep the existing fencing (`first=Kᵢ`, `last=Kᵢ₊₁`) — do NOT drop `last_frame` (it's what
  makes each clip converge to the shared boundary the next clip starts on).

Net: no new infra, no extra cost, runs in local `bun dev`, and attacks the root cause.

## If joins still visibly drift after validation

Only then revisit real-frame chaining, via **Cloudflare Browser Rendering** (`env.BROWSER`,
which alchemy DOES model and runs locally via remote binding) — a headless page seeks the
signed video to its end and canvas-captures the frame. Heavier per-op, so it stays a plan B,
not the default.

## Validation

Generate a fresh episode (studio or `scripts/simulate-studio.ts`) under Sandro's account and
check: bright Crunchyroll palette, on-model Blue Lock look, physically-plausible motion inside
each clip, and smooth boundaries between clips.
