# Studio fixes backlog

Status: **open backlog** (2026-07-12). Every issue below was caught during a
live pass over the Studio. Ordered by evaluation weight — UI/UX polish first,
then generation correctness, then output quality. Each entry has the symptom,
the root cause with `file:line`, the fix approach, and acceptance criteria so
it can be picked up and closed cleanly.

Conventions: reuse shadcn tokens + `glass-composer`/`surface-panel` glass +
`MainButton` for hero actions (see `docs/studio-design-language.md`). Compose
classNames with `cn()` from `@/libs/utils` — never ternary/backtick
concatenation. Keep `bun run check-types` / `test` / `biome` green.

---

## 1. Timeline ruler numbers still clip  ·  P0 (UI/UX)

**Symptom.** The first ruler label (`0:00`) and, at some zooms, edge labels
read as cut off — as if something has `overflow: hidden` shaving the digits.
Looks broken; highest-visibility surface.

**Root cause.** The strip insets its content with a **negative-space / exact-
width trick** instead of real padding:
- `apps/web/src/feature/studio/components/timeline-strip.tsx` — the outer box
  is sized `width: trackWidthPx + RULER_INSET_PX * 2` and the inner track is
  pushed in with `marginLeft: RULER_INSET_PX` (~line 493–497). The `0:00` label
  lives at the inner origin, so once the container is scrolled (`scrollLeft > 0`)
  or the ancestor clips, the digits sit at/over the clipped edge.
- The scroll container is `overflow-x-auto overflow-y-hidden`
  (timeline-strip.tsx ~line 485) **inside** `surface-panel`, which is itself
  `overflow: hidden` with rounded corners. Two nested clippers whose edges the
  labels can reach.
- `time.ts` derives widths from a `fit`/`max`-style computation
  (`fitPxPerSecond`, exact `trackWidthPx`) rather than a `min-width` that simply
  fills and grows.

**Owner directive (verbatim intent).** "En vez de usar un max size o cosas así,
deberías usar **min size y padding, gap**, etc. Por ahí va el tema del overflow
hidden que corta los números."

**Fix.**
1. Drop the `marginLeft` + `trackWidthPx + RULER_INSET_PX*2` outer-box hack.
2. Put **real horizontal padding** on the scroll container
   (`padding-inline: RULER_INSET_PX`) so the inset is part of the scrollable
   area and survives scrolling. Add `scroll-padding-inline: RULER_INSET_PX` and
   a trailing `padding-inline-end` (or an `::after` spacer of `RULER_INSET_PX`)
   so the LAST label keeps its room too (browsers don't always honor
   `padding-right` on overflow content).
3. Size the track with **`min-width: 100%`** (fills the container, no dead
   space) and let `trackWidthPx` drive growth only when zoomed in — express it
   as a min, not an exact/max.
4. Audit the two nested `overflow` clippers: the ruler labels must never render
   under `surface-panel`'s rounded `overflow: hidden`. Either move the ruler's
   label row out of the clipped box, or guarantee the padding keeps every label
   ≥ `RULER_INSET_PX` from both edges at every zoom + scroll position.
5. Keep the already-shipped wins: scrubber-style tick pills, edge-anchored
   first/last labels, the `0:00`-clear-of-playhead nudge, the full-width ruler
   over the empty track, and the Premiere zoom range — this is a
   width/overflow refactor, not a redesign.

**Acceptance.** `0:00` and the final label are fully visible at every zoom AND
at `scrollLeft > 0`; no label is ever clipped by any ancestor `overflow`;
widths come from `min-width` + `padding` + `gap`, not `marginLeft`/exact-width
math. Verify by measuring `label.getBoundingClientRect()` against the scroll
container at min zoom, fit, max zoom, and mid-scroll.

---

## 2. Player generating state is a box-in-a-box  ·  P0 (UI/UX)

**Symptom.** During first-run generation the player shows a small glass **card
centered inside** the player's own bordered well — a box inside a box.

**Root cause.** `apps/web/src/feature/studio/components/player-generating-state.tsx`
wraps both the generating and failure content in a `max-w-sm rounded-2xl`
glass plate (`PLATE_CLASSNAME`, line 29–30) that sits inside the player canvas,
which already has its own frame (`player-canvas.tsx`).

**Owner directive.** "Lo mejor sería tener **full glass en el bg, todo el
player**" — the whole player surface becomes the glass generating field, no
inner card.

**Fix.**
1. Remove the inner `PLATE_CLASSNAME` card. Make the **entire player canvas**
   the `glass-composer` surface while generating (the glass fills the player
   well; the loader + label center in it).
2. `player-canvas.tsx` decides the WHETHER; `player-generating-state.tsx`
   renders only the centered loader + label (and the failure/Retry) directly on
   that full-bleed glass — no nested rounded box.
3. Keep it non-blocking (the rest of the Studio stays interactive) and keep the
   `role="status"` / `role="alert"` semantics.

**Acceptance.** No nested card: one glass surface = the player. Generating and
failure states both read as the player itself, centered content, no inner
border/`max-w-sm` plate.

---

## 3. Loader: one dynamic loader with a switching label  ·  P1 (UI/UX)

**Symptom.** The generating loader feels static. The reference is the landing
hero's word that switches between types, and the smoothui demo's
Thinking/Generating/Searching cycle.

**Owner directive.** "En vez de que se quede fijo el item del loading, que solo
el loading vaya cambiando con el **efecto de switch como la letra del hero del
front** que va switcheando entre tipos. Más dinámico, súper pulido con motion."

**Fix.**
1. Keep ONE `GridLoader` (`components/ui/smoothui/grid-loader`), already in
   `sequence` mode — but drive its pattern from the **current phase** so the
   grid morphs as the real phase advances.
2. Animate the **label** with the hero's rotator:
   `apps/web/src/components/ui/word-rotate.tsx` (`WordRotate`) — the ±16px slide
   + `blur(4px)` crossfade, spring width. Feed it the live phase words
   (from `describeFirstRunStatus`, e.g. "Planning the story" → "Generating
   keyframes" → "Rendering scene 2 of 3"). Reuse `WordRotate`, don't re-author
   the animation.
3. Pair the grid pattern with the label phase (thinking/generating/searching-
   style mapping) so the mark and the word switch together. `prefers-reduced-
   motion` already handled by `GridLoader`; `WordRotate` must fall back to an
   instant swap under reduced motion.
4. Super-polished motion: ease-out, no bounce (design-language §4).

**Acceptance.** A single loader whose grid + label switch in sync with the real
generation phase, using `WordRotate` for the text; smooth, no layout jump,
reduced-motion safe.

---

## 4. Console flooded with `AbortError`  ·  P1 (correctness/noise)

**Symptom.** Repeated `AbortError: signal is aborted without reason` at
`src/libs/orpc/client.ts:25`, triggered on query teardown and by
`use-project-events.ts:37` invalidations.

**Root cause.** The oRPC link's error interceptor logs **every** error,
including benign query cancellations:
`apps/web/src/libs/orpc/client.ts:24-26` — `onError((error) => console.error(error))`.
When TanStack Query cancels an in-flight request (component unmount, or an SSE
event calling `invalidateQueries`), fetch rejects with `AbortError`. That's
normal cancellation, not a failure — but it's logged as an error.

**Fix.** In the `onError` interceptor, swallow aborts: skip when
`error?.name === "AbortError"` (or the cause is an `AbortError` /
`DOMException` abort). Log everything else unchanged.

```ts
onError((error) => {
  if (error instanceof Error && error.name === "AbortError") return;
  console.error(error);
});
```

**Acceptance.** No `AbortError` in the console during normal
navigation/unmount/SSE invalidation; genuine errors still log.

---

## 5. SSE doesn't auto-show the item as it generates  ·  P1 (RT)

**Symptom.** After hitting generate, there's no automatic SSE-driven update /
item appearing; the scene doesn't surface live.

**Root cause (two layers).**
- **Real generation failure masks it** — see #6 (kie 400). If the scene fails,
  there's no `video_ready` event to show, so "nothing appears" is partly a
  failed generation, not a broken transport.
- **Transport fragility** — the SSE path
  (`apps/web/src/feature/studio/hooks/http/use-project-events.ts`) is correct
  (invalidate-on-event → refetch), but it depends on the worker keeping
  `CORS_ORIGIN` after restarts. On a dev-worker restart the browser gets CORS-
  blocked on `/rpc/*` and `/projects/:id/events`, so events never arrive until
  a fresh worker. The slow fallback poll (`use-project.ts`) is the backstop.

**Fix.**
1. Close #6 first (a successful generation must emit the status transition the
   DO broadcasts).
2. Verify the DO broadcasts on EACH committed status transition (scene
   `keyframe_ready` / `video_ready`, project phase changes) and that the client
   invalidation re-renders the timeline item's loading→ready swap.
3. Make the "generating" item appear **immediately, optimistic** on submit
   (place the scene/clip in the timeline in a loading state right away), then
   let the SSE `video_ready` event flip it to ready — the owner's earlier ask:
   "meter el ítem en el timeline pero dejarlo como cargando hasta que el evento
   avise que está ok."
4. Confirm the dev CORS regression is environmental (worker restart), not a
   code bug — document the restart remedy; don't chase it as a code fix.

**Acceptance.** Submitting generation puts a loading item in the timeline
instantly; when the scene finishes, an SSE event flips it to ready with no
manual refresh (poll only as fallback).

---

## 6. Keyframe generation fails: "kie 400"  ·  P1 (generation)

**Symptom.** "Keyframe generation failed on retry. (kie 400)" — the keyframe
image call to kie.ai returns HTTP 400.

**Root cause (to confirm).** A 400 from the gpt-image endpoint is a
request-validation rejection. Likely candidates, in order:
- A malformed / too-long prompt, or a prompt the model refuses (e.g. a real
  celebrity name + likeness — see #7 — can trip content validation).
- `input_urls` that aren't reachable/valid to kie.ai (presigned URL expired, or
  a sheet asset that itself failed), or exceeding `MAX_IMAGE_INPUT_URLS` (16)
  in `packages/kie/src/image.ts:15`.
- An aspect-ratio / resolution value the endpoint rejects.

**Fix.**
1. Capture and log the kie 400 **response body** (not just the status) at the
   `packages/kie/src/image.ts` call site and in `generation.service.ts` so the
   exact validation reason is visible.
2. Reproduce with a known-good vs. the failing prompt; bisect prompt vs.
   `input_urls` vs. params.
3. Harden: validate/trim the prompt length, drop unreachable `input_urls`
   before the call, and surface a specific `failReason` to the UI instead of a
   bare "kie 400".

**Acceptance.** The real 400 reason is logged and understood; a fix or guard is
in place; the retry path succeeds on a valid request and shows a specific error
(not "kie 400") when it legitimately can't.

---

## 7. Generated assets don't match the Blue Lock template style  ·  P1 (output quality)

**Symptom.** Some generated assets come out photographic (e.g. a real Messi-like
still) instead of the template's anime style — while invented characters render
correctly as anime.

**Root cause.** NOT a missing style reference — text alone already produces the
style. Enforcement is textual and strong, and it works: the bug is only that
**real-entity names override it** on specific subjects.
- The Blue Lock style is a text `styleBibleSeed`
  (`packages/types/src/templates.ts:25-32`) compiled into a text style block
  (`packages/ai/src/prompts/style-bible.ts`) and injected into every asset
  prompt (`packages/ai/src/prompts/prompt-builders.ts`) — the text does NOT
  drop out.
- The text style enforcement is ALREADY strong and in every prompt:
  `compileStyleBible` appends `ANIME_CONSISTENCY_CLAUSE`
  (`packages/ai/src/prompts/style-bible.ts:18`) — literally *"2D cel anime only
  — no 3D render, no photorealism, no live action"* — to every character,
  location, keyframe, and video prompt (`prompt-builders.ts`).
- **The template stills (`soccer-v2.png` …) were themselves generated from
  TEXT ONLY** — no reference image. Proof that text-to-image reliably produces
  the Blue Lock style. A style-reference image is therefore NOT necessary.
- So the real cause is NOT a missing reference. It's **model weighting on real
  entities**: a concrete named celebrity ("Lionel Messi" + "real build, hair,
  skin tone") or a real place gives gpt-image a photographic prior that
  outweighs the generic anime clause — so those specific subjects go photoreal
  while invented characters stay anime. The old `REAL_PERSON_CASTING_DIRECTIVE`
  (`packages/ai/src/prompts/story-direction.ts`) asked for "recognizable
  real-world likeness … actual build, hair, skin tone", which fed that prior.

**Fix (text-only — done).**
1. **Strengthen `REAL_PERSON_CASTING_DIRECTIVE`** so the anime framing dominates
   the celebrity likeness: it now leads with "an ANIME CHARACTER … a 2D
   cel-anime drawing … never a photograph … if it could be mistaken for a photo
   of the real person, it is wrong", then the recognizable traits redrawn as
   anime. Recognizable, but unmistakably anime.
2. **Rejected: the reference-image approach.** Wiring the template still into
   `input_urls` (a `Template.styleReferenceKey` field + an R2 seed + a
   per-run `headObject` + image-to-image sheets/keyframes) was implemented then
   **reverted** — text already produces the style (point 2 above), so it added
   infra for no necessary gain. `packages/kie/src/image.ts` still supports
   `inputUrls` if a future need arises, but the callers stay text-to-image.
3. **Follow-up if needed:** if real *locations* (a named stadium) still render
   photoreal, apply the same anime-dominant wording to the location prompt —
   another text tweak, not a reference image.
4. Re-run the AI evals (`packages/ai/evals`, incl. the Messi real-person
   fixture) to confirm plan quality holds.

**Acceptance.** Character sheets and keyframes render in the Blue Lock anime
style (cel shading, clean lineart, anime faces) — including for real-named
players (recognizable, but anime, not photographic) — from TEXT alone, no
reference image.

---

## Suggested order

1. **#1 timeline** and **#2 player box-in-box** — most-visible UI/UX, cheap.
2. **#3 loader switch** — polish, cheap, high perceived quality.
3. **#4 AbortError** — one-line noise fix.
4. **#6 kie 400** → **#5 SSE live item** — generation must succeed before the RT
   swap can be seen end-to-end.
5. **#7 Blue Lock style** — a text-only real-person prompt fix (no infra).

