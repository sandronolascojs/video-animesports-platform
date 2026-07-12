# Studio design language — v1

Status: **living spec** (2026-07-12). The reference we adjust the whole Studio
against, to reach top-tier consumer-tool polish. The Studio is where people
spend their time and shape their episodes, so it is the single most important
surface in the product — its craft sets the bar for the whole app.

This is a **structure + craft** refinement, NOT a re-skin. We keep the existing
visual system exactly.

---

## 0. Hard constraints (do not break)

1. **No color / token changes.** Keep every shadcn token and class as-is
   (`bg-background`, `text-muted-foreground`, `border-sidebar-border`,
   `bg-sidebar`, the `--radius` scale, etc.). The app is forced-dark and
   near-monochrome by design; identity-preservation wins.
2. **Reuse shadcn primitives** (`Button`, `Empty`, `Tooltip`, `Progress`,
   `Select`, `ButtonGroup`, `Skeleton`, …) — don't hand-roll what exists.
3. **Pro / hero CTAs use `MainButton`** (`components/kit/main-button.tsx`):
   shadcn `Button` (ghost) + `glass-composer` material + an always-on colorful
   `BorderBeam`. That animated beam over glass IS our premium accent — we do
   NOT introduce a solid brand color. Use it for the single most important
   action on a surface (Generate / Render / Export). Everything else is a
   normal shadcn `Button` variant.
4. **Glass material for elevated surfaces**: `glass-composer` (the AI input's
   frosted card) and `glass-edge` / `surface-panel` are the vocabulary for
   floating/elevated things (composer, chat rail, the generating pill). Reuse
   them; don't invent new glass.
5. **Amber = generating** (already established); no new semantic colors.

The premium feeling comes from: glass + BorderBeam on the hero action,
disciplined flat structure, generous spacing, exact hierarchy, and motion —
never from adding hues.

---

## 1. Design principles

The Studio is a consumer tool, not a pro NLE — so restraint, clarity, and a
single obvious action per surface beat density. The principles we hold every
surface to:

- **Flat surfaces, zero nested cards.** Sections are separated by spacing +
  hairline dividers, not cards inside cards. Cards (when used) are single-level,
  radius ~`rounded-xl`/`rounded-2xl` (12–16px), subtle border/fill.
- **Prompt-first composer is the hero.** A big rounded glass bar: prompt +
  inline **param pills** (icon + short label) + ONE prominent CTA. Any context
  selectors sit just above it, never buried.
- **Param pills**: small, `rounded-lg`, faint fill, hairline, 14px icon + 13px
  label, muted → hover brighter; `tabular-nums` for numbers; a small circular
  thumbnail when the option is image-backed. Steppers render `−  N  +` inline.
- **Clean sidebar/rail**: small icon + label rows, active = a subtle filled
  rounded row; muted section labels with search/sort affordances.
- **Premium empty states**: a soft icon + bold title + one muted hint, lots of
  breathing room. Starter actions as flat, tappable suggestion rows.
- **Bold display type** for first-run/empty headlines; monochrome + one accent
  line.
- **Generous spacing, minimal chrome, high contrast.** Restraint everywhere —
  one hero action per surface, everything else quiet.

Identity stays exactly as-is: forced-dark, near-monochrome shadcn tokens, the
glass material, and the BorderBeam on hero CTAs.

---

## 2. Component recipes (built from what exists)

**Hero CTA** → `MainButton`. Generate (first-run/extend), Render, Export.
One per surface, unmistakable. `wrapperClassName="block w-full"` for full-width
form CTAs.

**Secondary / tertiary buttons** → shadcn `Button` variants as-is:
`variant="outline"` for standing secondary actions, `variant="ghost"` for
icon-only controls (zoom, minimize, close, play/pause), `size="icon-sm"` /
`"icon-xs"`. Never over-round; keep the primitive's radius.

**Param pill** (aspect / voice / subtitle / duration / scene-count / zoom):
a compact control — a `Button variant="ghost" size="sm"` (or a styled
`span`/`button`) with `gap-1.5`, a 14px lucide icon, a 13px label, muted text
that brightens on hover, `rounded-lg`, faint `bg-white/[0.04]` hover fill,
`tabular-nums` for any number. Group related pills with `ButtonGroup` where it
reads as one control (e.g. the zoom `− / +`).

**Elevated / floating surface** → `glass-composer` (interactive, e.g. the
chat composer, the generating pill) or `surface-panel` (structural panels).
Don't stack glass on glass.

**Empty state** → shadcn `Empty` (`EmptyHeader`/`EmptyMedia`/`EmptyTitle`/
`EmptyDescription`) with a soft icon and one clear hint. For the chat rail, add
a few tappable suggestion rows ("Extend the story by 2 scenes", "Retry the
failed shot", "Render a new version") that prefill the composer.

**Flatten rule (the card-in-card fix)**: a panel is ONE surface. Its items are
rows separated by `border-border/60` dividers or spacing — not each wrapped in
its own bordered card. A per-item error/status is inline (icon + text + a small
action), not a nested bordered box. Radius on any real card tops out at
`rounded-2xl`.

---

## 3. Surface-by-surface target state

### 3a. Left panel — Scenes / Assets / Subtitles  (biggest slop offender)
Today: a bordered panel containing bordered scene **cards**, each containing a
bordered **error box** with Retry — 3 levels of nesting. Target: one
`surface-panel`, a segmented tab row (Scenes/Assets/Subtitles), then a flat
**list of scene rows** separated by hairline dividers. Each row: a small
keyframe thumb (or a placeholder tile), the scene title, a compact status
(pill or inline text: "Generating video…", "Failed"), and a right-aligned
action (delete / retry) revealed on hover. The failed state is an inline red
line + a ghost "Retry", not a nested card. "Add scene" is a full-width ghost
row at the bottom.

### 3b. Player + generating state
Keep the non-blocking generating state (RT pivot). Refine the loader from a bare
`GridLoader` glow into a **premium centered treatment**: the GridLoader inside a
soft `glass-composer` pill/plate with the live status ("Generating scene N of
M…") and the muted subline — a composed, deliberate moment, not a naked grid on
black. Failure → inline error + a `MainButton`-or-ghost Retry. Once a scene is
ready, the real player takes over.

### 3c. Timeline  (looks basic → make it pro)
- **Clips**: drop the rainbow gradient blocks for a calmer treatment — the
  scene's keyframe thumbnail as the clip fill (or a single subtle
  brand-tinted/monochrome surface when no thumb), title + duration as small
  overlaid labels with a legibility scrim, selected = a clean ring, generating =
  a subtle animated shimmer. `rounded-lg`, hairline separators.
- **Scrubber / playhead**: adopt the smoothui **scrubber** aesthetic — a slim
  capsule playhead, faint tick marks on the ruler, `tabular-nums` timecode.
  Vendor `components/ui/smoothui/scrubber` if we use it directly, or match its
  look with our own playhead. Spring the thumb (ease-out, no bounce).
- **Ruler**: lighter, evenly spaced ticks + sparse labels; `tabular-nums`.
- **Controls row**: play/pause (ghost icon), timecode (mono tabular), zoom as a
  `− / +` `ButtonGroup` param-pill, and **Render as a `MainButton`**. Cancel =
  ghost icon while running.
- **Mouse / trackpad gestures** (required): trackpad **pinch-zoom** must work
  (browsers fire it as `ctrlKey`+wheel on every OS — the current
  `isMac ? metaKey : ctrlKey` check misses Mac pinch; handle `ctrlKey` for
  pinch on all OSes AND `metaKey`/`ctrlKey` for Cmd/Ctrl+wheel), plain
  **wheel/two-finger scroll pans** horizontally, and zoom keeps the point under
  the cursor stable. Keep the `+/−` buttons as the explicit fallback.

### 3d. Right chat rail — "Director"  (consolidate + polish)
- **Kill the floating dock in the Studio.** The dock doesn't fit; the Director
  lives ONLY in the right rail. (`AIDock`/`AIDockInput` stay for the Dashboard
  create composer.) Removing the dual dock↔sidebar model is a real consumer
  simplification.
- **Open affordance** moves to the Studio topbar: a clear "Director" button/icon
  toggles the rail (keep ⌘J). The rail's own header keeps a close (✕).
- **Size +20%**: `19.2rem → ~23rem` inner width.
- **Glass**: give the rail the `glass-composer`/`surface-panel` material so it
  reads as the same premium family as the app sidebar; the composer inside it
  is the shared `AIDockInput` glass.
- **Header**: keep "Director" (on-brand persona = the agent), polished.
- **Empty state**: a soft/glossy icon, a short title, and 3 tappable suggestion
  rows that prefill the composer.

### 3e. Topbar
Project title + status pill (`Generating · N/M`, `tabular-nums`) left; right:
the **Director** toggle, **Export** as a `MainButton`, Back as a ghost. Flat,
thin, high contrast.

### 3f. Composer (`AIDockInput`, shared Dashboard + rail)
Prompt-first; the selector toolbar (aspect / voice / subtitle / scene-count)
renders as **param pills**; submit is bold. Keep the glass material and the
placeholder rotation.

---

## 4. Motion
Existing curves: ease-out drawer `[0.32, 0.72, 0, 1]`, `cubic-bezier(0.23,1,
0.32,1)` for scrub/fill; no bounce, no elastic. Spring the scrubber thumb.
Stagger scene rows subtly on first paint. Every animation needs a
`prefers-reduced-motion` fallback (crossfade/instant); `motion-safe:` for
decorative pulses. Motion is part of the build, not an afterthought.

---

## 5. Don'ts (match-and-refuse)
- Nested cards (card-in-card) — always wrong. Flatten.
- A muted/ghost button where the surface's ONE hero action belongs → use
  `MainButton`.
- Over-rounding (`rounded-3xl+` on cards), side-stripe accent borders,
  glassmorphism as decoration (glass is purposeful here, not sprinkled),
  gradient text, identical card grids, tiny tracked eyebrows on every section.
- New colors / palette changes. Reuse shadcn tokens verbatim.
- A rainbow of clip gradients reading as "basic".

---

## 6. Progressive adjustment order
1. **Flatten the left panel** (Scenes/Assets/Subtitles) — kill the card-in-card.
2. **Chat consolidation** — remove the Studio dock, Director rail only (+20%,
   glass, topbar toggle, premium empty state).
3. **Timeline pro** — clips, scrubber/playhead, ruler, controls as pills +
   `MainButton` Render, mouse/trackpad zoom+pan gestures.
4. **Player generating** — the GridLoader in a glass plate, refined.
5. **Composer + topbar** — param pills, `MainButton` hero actions, status cue.

Each step: reuse shadcn + glass + `MainButton`, verify in the browser against
this doc, adjust. Keep `bun run check-types` / `test` / `biome` green.
