# Studio quality pass — analysis + fixes

Status: **analysis / architecture (2026-07-12)**. Goal: reach Blue Lock 2025
(Crunchyroll) level — coherent story, faithful player, clean UI, real subtitle
sync. Each point below: symptom → root cause → proposal(s) → OPEN QUESTION
(decisions to make together before implementing).

---

## 1. Story coherence + scene length + generation model  (AI/output — highest impact)

### 1a. Cross-scene continuity ("Kaito suddenly has the ball", jump cuts)
**Symptom.** Between scenes the action jumps — the keeper kicks, then Kaito
kicks; a big gap between scenes; the ball flies backwards into the net.

**Root cause.** Continuity today is anchored ONLY by generated keyframes: the
K1..K_N+1 chain (`generation.service.ts::buildKeyframeInputUrls`) makes scene
i+1's START keyframe = scene i's END keyframe (a gpt-image generated with the
previous keyframe as reference). Seedance then animates each scene between its
own start/end keyframe. Two failure modes:
1. The Seedance VIDEO doesn't actually LAND on its end keyframe (it drifts), so
   the next scene — which starts from that keyframe — jump-cuts.
2. The keyframes themselves are independent gpt-image generations, so the
   character/ball position can differ from where the last video frame really
   ended.

**Proposals** (this is the main fork — see the OPEN QUESTION):
- **A. Real-last-video-frame chaining (owner's preference).** After scene i's
  video is ready, extract its ACTUAL last frame (server-side ffmpeg/mediabunny
  on the R2 mp4, or Seedance's own last frame), store it as an asset, and use
  it as scene i+1's `first_frame_url`. The video literally continues from where
  the previous one ended — tightest possible continuity. COST: videos become
  SEQUENTIAL again (scene i+1 needs scene i's finished video), which REVERTS the
  parallel-video speedup we just added. Keyframes were already sequential, so
  the only loss is the concurrent video phase.
- **B. Keep concurrency, fix via prompt + model.** Keep the keyframe chain
  (videos stay parallel). Make the plan agent author each scene's action as an
  explicit continuation of the previous end state ("the ball is already
  traveling toward the top-left corner; Kaito meets it mid-air…") with clear
  physics, and force Seedance to hold the end frame. Less guaranteed than A.
- **C. Hybrid.** Real-last-frame chaining for the START anchor, but still cap
  Seedance to land on the planned end keyframe; accept sequential videos.

### 1b. Physics that make no sense (ball reverses direction)
**Root cause.** Seedance interpolates start→end frame; when the two frames imply
an impossible motion (or the prompt is vague), it invents nonsense. Shorter
scenes + explicit single-action prompts reduce this. The end-frame must be a
physically-plausible continuation of the start-frame (helped by 1a-A).

### 1c. Scene length — too long, no logic
**Symptom.** The coach-hug scene is 12s; could be 6-8s. Scenes generate long
unnecessarily.
**Root cause.** The plan agent picks `durationSeconds` via
`buildDurationDirectionGuidance` (`packages/ai/src/prompts/story-direction.ts`)
— it allows the full MIN..MAX range with editorial bands, but biases long.
**Proposal.** Rewrite the guidance to bias SHORT and action-appropriate:
default 4-6s for most beats, 6-8s for dialogue/action, reserve 10-15s ONLY for a
rare held emotional beat — and tell the model to justify any duration >8s. A
single decisive action (a kick, a save, a shout) should be 4-6s. The more
creative model (1d) should also reason about pacing per shot.

### 1d. Model swap: sonnet-5 → gpt-5.6-terra (owner request)
**Ask (owner).** Use a more advanced/creative model for STORY generation than
sonnet-5 — e.g. `gpt-5.6-terra`.
**Proposal.** Point the PLAN + EXTEND agents at the more creative model (via the
AI Gateway model id) — find where the plan/extend agent model is configured
(`packages/ai/src/agents/*`), swap the model id, keep the JUDGE/eval models a
DIFFERENT family (avoid self-preference). Verify the plan schema still validates
and the evals still pass. Keep sonnet available as a fallback.

### 1e. Continuity — VALIDATED against docs + industry practice (2026-07-12)
Owner asked to validate online before deciding. Findings:
- **kie Seedance-2-mini docs**: "Image-to-Video (First & Last Frames)" and
  "Multimodal Reference-to-Video" (`reference_video_urls`) are MUTUALLY
  EXCLUSIVE. There is NO native "video extension". The docs explicitly
  recommend: *"Extract the previous clip's final frame and pass it as
  `first_frame_url` for the next generation — this ensures strict frame
  matching."* → Option A is the documented path; `reference_video_urls` is NOT
  for seamless continuation.
- **Industry standard ("last-frame conditioning" / video-extend)**: every
  extend/chain workflow (Veo3, LTX, Hailuo, Seedance) receives the final frame
  of the current clip as the START of the next and generates frames that "flow
  naturally… same character, same environment, same camera perspective." Best
  practice: keep the same scene/lighting across a scene's first↔last frame; make
  the last frame different enough for narrative but similar enough for a smooth
  transition. Some pipelines also run a **video-understanding** pass to describe
  the last frame for the next prompt.

**Decision: Option A (last-frame chaining), validated.** Per-scene keeps
`first_frame_url` (= prev scene's REAL last video frame) + `last_frame_url` (=
this scene's end keyframe target). Videos become SEQUENTIAL (accepted).

**Frame extraction — DECIDED + validated (2026-07-12): Cloudflare Media
Transformations Workers binding.** The generation runs in Cloudflare Workers (no
ffmpeg; `workerd` does NOT expose WebCodecs `VideoDecoder`, so Mediabunny — which
wraps WebCodecs — can't decode a frame there). Cloudflare's OWN, purpose-built,
native answer:
- **Media Transformations Workers binding** (public open beta since 2026-03):
  bind `env.MEDIA`; `env.MEDIA.input(<ReadableStream>)` → transform with
  **`frame` mode + a `time`** → returns a STILL IMAGE from that point of the
  video. Works on videos in PRIVATE R2 (via the binding, no public URL). Output
  modes: video / **frame** / spritesheet / audio. Docs literally cite the use
  case "extract still frames … for classification/description with Workers AI".
  **Free during the beta.**
- Why not the others: Mediabunny → no WebCodecs in workerd. kie
  video-understanding → extra cost + external + auth-unknown. ffmpeg → not in
  Workers. Cloudflare Media Transformations is native, R2-aware, free, zero
  extra deps.

**Continuity implementation plan (Q1a + Q1b resolved):**
1. Add the `MEDIA` (Media Transformations) binding to the worker config
   (`packages/infra/alchemy.run.ts`) + the server `env` types.
2. After scene i's video is ingested to R2, extract its LAST frame via
   `env.MEDIA.input(r2Stream)` with `frame` mode at `time ≈ durationSeconds`
   (last frame), store the still as an R2 asset.
3. Use that still as scene i+1's `first_frame_url` (presigned) — scene i+1's
   Seedance call is [real last frame of scene i] → [scene i+1's end keyframe].
4. Videos become SEQUENTIAL (scene i+1 waits for scene i's video + frame
   extract). Accepted per the validated decision.
5. Optional polish: also run a Workers-AI describe on that frame to enrich the
   next scene's continuation prompt (the "video-understanding" step best
   practice mentions) — nice-to-have, not required for v1.

> **OPEN QUESTION 1 — FULLY RESOLVED:** Option A (last-frame chaining) via the
> **Cloudflare Media Transformations Workers binding** (`env.MEDIA`, `frame`
> mode). Validated: kie docs recommend last-frame seeding; Media Transformations
> is Cloudflare's native, R2-private, free-in-beta frame extractor. Deferred
> until after the UI-first pass (owner's chosen order).

---

## 2. UI bugs / polish

- **2a. Remove scrollbars.** Kill the visible scrollbar on the timeline strip
  (`timeline-strip.tsx`) and the scenes list (`scenes-panel`/`left-panel`). Keep
  scrolling functional (overflow), just hide the bar (`scrollbar-width: none` /
  `::-webkit-scrollbar { display:none }` — there's likely already a
  `scrollbar-thin` util to replace with a hidden variant). The timeline already
  communicates panning via the ruler.
- **2b. Item → dedicated edit dialog.** Clicking a scene (or asset) opens a
  shadcn `Dialog` with that item's editable content (prompt, dialogue, subtitle,
  duration for a scene; metadata for an asset) — instead of cramming editable
  fields into the narrow left panel. The panel row becomes a trigger.
- **2c. No long text inline.** Don't render long prompt/error text inside the
  narrow scene row. For per-scene ERRORS, use a shadcn `Tooltip` (icon → tooltip
  with the failure reason) instead of an inline line.
- **2d. SSE connection error.** Console shows `[use-project-events] connection
  error`, `ERR_NETWORK_IO_SUSPENDED`, `WebSocket is already in CLOSING or CLOSED
  state`. `ERR_NETWORK_IO_SUSPENDED` = the browser suspended the tab/network
  (backgrounded) and the `EventSource` dropped; the reconnect/onerror path just
  logs. Proposal: (1) downgrade this to a non-error log (it's expected on
  suspend/nav), (2) verify the EventSource cleanly reconnects on resume (the
  `onopen`-reinvalidate path exists — confirm it fires), (3) confirm it's not
  masking a real CORS/worker drop. Low severity; mostly log-noise cleanup.
- **2e. Export/render button.** Remove the external status label + the external
  Cancel button. The button alone shows state: idle = "Export", running = a
  shadcn spinner INSIDE the button (disabled), done = back to "Export". No
  separate cancel affordance. (`studio-topbar.tsx` — the MainButton +
  `renderButtonLabel` + the `isRunning` cancel block.)

---

## 3. Subtitles — real sync + richer controls

**Symptom.** The subtitle is ONE fixed line shown for the WHOLE scene
(`composition.tsx::SubtitleOverlay` renders `activeScene.subtitleText` for the
entire Sequence). It should appear/disappear timed to the spoken voice, like
anime.

**Root cause.** We have only ONE `subtitleText` string per scene and no timing.
With ElevenLabs removed there are no TTS word timestamps either.

**Proposals** (fork — OPEN QUESTION 2):
- **A. Estimated timing (no new pipeline).** Split the scene's dialogue into
  short cues and distribute them across the scene duration by word count (anime
  cues are ~1-3s each). Render each cue only during its window. Rough but zero
  extra cost; good enough to read as synced.
- **B. Forced alignment / STT.** Run a speech-to-text with word timestamps over
  the Seedance audio and align the known dialogue text → accurate cue times.
  Needs an STT model the key is authorized for (unknown — the key is NOT
  authorized for ElevenLabs; must check what IS). Adds a pipeline step per scene.
- **Data model change either way:** replace `scenes.subtitle_text: string` with
  a list of timed cues (`{ text, startMs, endMs }[]`), and have
  `SubtitleOverlay` pick the cue active at the current frame.

**Richer controls (2198 view).** Extend the Subtitles tab beyond size/weight/
color/outline/background/position: add line-height, max width, font family
choice, per-cue timing nudge, shadow, and a live preview. Keep the shadcn
primitives.

> **OPEN QUESTION 2:** Subtitle sync via **A (estimated split — cheap, approximate)**
> or **B (STT forced-alignment — accurate, needs an authorized STT model + a
> pipeline step)**? (Recommendation: **A** now, B later — A reads as synced and
> costs nothing; confirm there's even an authorized STT model before betting on B.)

---

## 4. Player fidelity (must equal the render)

**Symptom.** The player has cuts / fade-in-out / "weird effects"; it should be a
continuous preview identical to the final render.

**Root cause.** `composition.tsx::SceneLayer` applies an opacity FADE at every
scene's edges (`interpolate(frame, [0, fadeFrames, dur-fadeFrames, dur], [0,1,1,0])`).
The Mediabunny render just concatenates the clips (no fades) → the player does
NOT match the render.

**Proposal.**
- Remove the per-scene fade — `opacity` always 1, hard cuts between clips
  exactly like the concatenated render.
- Keep all scene videos loaded/preloaded so scrubbing + playback are smooth and
  continuous (Remotion `OffthreadVideo` + `pauseWhenBuffering`; consider
  `prefetch` of all scene URLs so there's no per-scene load gap).
- Ensure the player's clip order/durations/subtitles are byte-for-byte the same
  logic the render uses, so "what you preview is what you export".

---

## 5. Player control skin (on-theme, pro)

**Symptom.** Default-ish player controls; want them on-theme and clean.
**Proposal.** Skin the player transport to match the app: the play/pause as a
`MainButton`-style control (glass + BorderBeam accent — reuse
`components/kit/main-button.tsx`), the scrubber + timecode + volume + fullscreen
as ghost/param-pill controls consistent with the timeline. Note: the center
Player is the Remotion `<Player>` — check whether we use its built-in controls
(`controls` prop) or a custom control bar; to fully skin it we likely render a
CUSTOM control bar over the Remotion `PlayerRef` (play/pause/seek/fullscreen via
the imperative API) rather than the default chrome.

---

## 6. Agent chat — use ai-elements, contain scroll, clean chrome

- **6a. Use the ai-elements components** throughout the chat
  (`components/ai-elements/*`): message list, message bubbles, the input, etc.
- **6b. Contain the scroll.** The chat currently STRETCHES the layout; it must
  be `h-screen` max with the message list auto-scrolling INSIDE (the sidebar is
  fixed height; only the conversation scrolls, sticking to bottom). The
  refactor to the persistent `Sidebar` should already bound it — verify the
  `SidebarContent` is the only scroll container and the composer stays pinned.
- **6c. Recommendation bubbles.** Replace the plain suggestion rows with
  ai-elements recommendation/suggestion bubbles (outline or the glass material
  of the AI input), not flat text rows.
- **6d. Remove ugly separators.** Remove the `border-top` above the AI input AND
  the separator/border under the "Agent" title (2200/2201). Use spacing/glass
  instead of hairline borders there.
- **6e. Icon + composer.** Replace the clapperboard/movie icon in the Agent
  header with lucide `Bot`. Remove the scene-count dropdown from the composer —
  the agent decides how many scenes to create from the conversation, so the
  manual selector is redundant.

---

## Cross-cutting notes

- **Concurrency vs continuity** (see Q1) is the one real architectural conflict:
  real-last-frame chaining ⇒ sequential videos. Everything else is additive.
- **Subtitle data model** changes from a string to timed cues (Q2) — touches the
  scene schema, the plan output, `composition.tsx`, and the render.
- All UI work: reuse shadcn + `cn()` + glass + `MainButton`; no new colors.
- Do all code edits BEFORE any generation run (local Workflows die on reload).

## Proposed order

1. UI-only, no-risk: 2a, 2c, 2e, 4 (remove fades), 5, 6 (chat) — fast visible wins.
2. Scene edit dialog (2b) + subtitle controls UI (3, controls only).
3. Model swap (1d) + duration guidance (1c) — cheap AI wins, re-run to see.
4. Continuity (1a) — after Q1 decision; the big one.
5. Subtitle sync (3) — after Q2 decision.
</content>
