# Studio UI — View Flows, Layout, Agent Dock, Component Map

> Companion to `video-engine-architecture.md`. Defines every view's flow (Home → Generating → Studio), the Studio screen (edit + versions + agent), the chat-driven editing agent, and the exact mapping onto the components already installed (shadcn/ui radix-nova ×60, AI Elements ×48). Minimal, dark, Knock/Higgsfield-style. Motion rules follow `.agents/skills/emil-design-eng`.

## 0. View flows

### Home (`app/(private)/page.tsx`) — "what are we creating today?"

Higgsfield-style hero, Krea-style template cards. Base scaffold: `bunx --bun shadcn@latest add dashboard-01`, then strip it — we keep the sidebar shell (`collapsible="icon"`, ultra-narrow icon rail like the reference) and the layout patterns, delete the demo charts/tables.

```
┌──┬───────────────────────────────────────────────┐
│▐ │                                               │
│▐ │           {Name}, what are we creating today? │  ← greeting from session
│▐ │        ╭───────────────────────────────╮      │
│▐ │        │  Describe your sports anime…  │      │  ← PromptInput (AI Elements)
│▐ │        │                        ⏎  ↑  │      │
│▐ │        ╰───────────────────────────────╯      │
│▐ │      [⚽ Soccer] [🏀 Basket] [⚾ Base] [🎾 Tennis] │  ← 4 fanned template cards
│▐ │                                               │
│▐ │   Recent projects (cards grid, if any)        │
└──┴───────────────────────────────────────────────┘
```

- **Sidebar (shadcn Sidebar, Higgsfield-style)**: **expanded by default (~16rem), collapsible to icon rail** via the header toggle — smooth shadcn collapse animation, floating `surface-panel` card inset from the viewport edge. Structure top→bottom: header (logo/wordmark + collapse toggle), **"New project" prominent pill button** (rounded-full, jewel `+` icon, kbd hint on hover), Search item, "Projects" group label + recent project rows, footer (theme toggle + user menu). **Lucide icons only.** Never hand-rolled — shadcn `Sidebar` primitives throughout.
- **Auth guard (SSR)**: the whole `(private)` group is protected at the **layout** level — the server layout calls better-auth's session over SSR (`authClient.getSession({ headers })`, the existing pattern) and `redirect("/login")` when unauthenticated. No private page renders without a session.
- **Forms rule (app-wide)**: **react-hook-form + `@hookform/resolvers` zodResolver ONLY** — the shared zod schemas from `@video-platform-challenge/api` plug into `zodResolver`. `@tanstack/react-form` is removed.
- **Layout sizing rule**: page shells use **`min-h-svh`** (not fixed heights) so every view adjusts to the viewport correctly; inner panels flex/scroll within it.
- **Client state rule (app-wide)**: **zustand** for application client state. The Studio draft store (timeline order, scene edits, subtitle style, undo/redo stacks) is a zustand store — selectors per slice, actions colocated.
- **Dialog system rule (app-wide)**: ONE global typed dialog store (zustand) + a global `DialogProvider` mounted in the root layout. Pattern:
  - `libs/dialogs/registry.ts`: `type DialogPayloads = { "delete-scene": { sceneId: string; title: string }; ... }` — every modal key maps to its typed payload.
  - Store: `open<K extends keyof DialogPayloads>(key: K, payload: DialogPayloads[K])` / `close()`; a `useDialog()` hook exposes both, fully typed — opening a modal with the wrong payload is a compile error.
  - `DialogProvider` holds a `Record<key, LazyComponent>` map — each modal is **lazy-loaded** (`next/dynamic`) and only mounted while open. Modals are shadcn `Dialog`/`AlertDialog` restyled to the design language.
  - New modal = add registry key + lazy component entry. No inline `useState` dialogs anywhere.
- **Template cards**: one per sport (soccer, basketball, baseball, tennis), each with a **pre-generated anime image** (generated ONCE with gpt-image-2 at build/seed time, stored as static assets/R2 — never generated per pageview). Fanned/tilted arrangement like Krea's tool cards.
- **Creation options in the composer toolbar**: selector dropdowns (ProviderSelector pattern — borderless trigger, lucide icon + label, radix Select rows) in the input's bottom-left slot. **Aspect ratio selector (16:9 / 9:16) — HOME ONLY**: aspect ratio is immutable after creation and is read from the project everywhere in the Studio; the Studio dock never shows it. **Language selectors (voice + subtitle) appear in BOTH the Home composer and the Studio dock** (prefilled from the template default — anime → Japanese voice; in Studio they read/write the project's language settings).
- **Hover fills the input** (the Krea knight interaction): hovering a card previews that template's example prompt inside the input as **ghost text** (muted color, fades in 150ms ease-out). Mouse leaves → ghost fades out. **Click commits**: the prompt becomes real input value, input focuses, template is selected (card gets a selected ring). User can edit before submitting. If the user already typed something, hover does NOT override — ghost only shows on empty input.
- **Submit** (Enter or ↑ button): `projects.create({ templateKey, description })` → route to `/projects/[id]` which opens in the **generating state** (below).

### Login (`app/(auth)/login/page.tsx` + `app/(auth)/signup/page.tsx`)

Split-screen layout — no card, no dot grid, two routes:

- **Two routes, one form view**: `/login` (sign-in) and `/signup` (sign-up), both under the `(auth)` route group so `enforcePublicAccess()` covers each. Each page renders the same `grid min-h-screen grid-cols-1 md:grid-cols-2` shell: **left** a centered `max-w-sm` column with `AuthView` (`feature/auth/views/auth-view.tsx`) at the matching `mode`, **right** `AuthPanel` (`feature/auth/components/auth-panel.tsx`), `hidden` below `md`. The `(auth)` layout itself is a full-bleed passthrough — no dot-grid background, no composer-shell wrapper; the pages own the grid.
- **`AuthView`**: takes a `mode` prop (`"sign-in" | "sign-up"`) fixed per route — no in-place form swap, no crossfade. Internally two form components, each with its own `react-hook-form` instance. **Email + password** for sign-in, **name + email + password** for sign-up — schemas are `signInSchema`/`signUpSchema` from `@video-platform-challenge/api`, never inlined. Submits go through the existing better-auth flows (`authClient.signIn.email` / `signUp.email`); this is a reskin, not new auth logic. The footer prompt ("Don't have an account? Sign up" / "Already have an account? Sign in") is a `<Link>` navigating between `/login` and `/signup`.
- Inputs use the shared `Field`/`FieldLabel`/`FieldError` primitives wrapping `Input`; per-field zod messages render inline. Auth failures (e.g. invalid credentials) surface as a `toast.error` from `@/libs/toast` with a specific title; success fires `toast.success`. No separate inline alert — the toast is the single error surface.
- **`AuthPanel`**: a clean, fixed dark placeholder surface (`dark` class + near-black `bg-[#0d0d0d]`, independent of site theme), intentionally empty — its content is TBD (the earlier FlickeringGrid/status-badge/headline treatment was removed). No decorative overlays.
- After auth → `/` (Home), always — no callback URL handling.

### Generating state → Studio handoff

The loading IS the product filling itself in — never a blank spinner page:

1. Navigation lands on the Studio shell immediately (sidebar + topbar render; canvas in generating mode).
2. **Plan phase** (seconds): the story plan streams in — title, synopsis, then scene cards appear in the timeline strip as skeletons with staggered entrance (30–80ms delay each).
3. **Assets phase** (minutes): character sheets → location sheets → keyframes pop into their scene cards as they complete (status badges flip `planned → keyframe_ready → video_pending → video_ready`). Progress comes from the normal project polling; each completed generation replaces a skeleton with the real image (fade + scale 0.97→1, 200ms ease-out).
4. **Canvas during generation**: a Remotion-driven sequence in the player area — the storyboard keyframes animate as a filmstrip with a progress readout ("Generating scene 3 of 8…"). Remotion owns this choreographed, video-like sequence; plain CSS owns everything else.
5. **First render done**: version v1 appears at the top of the history panel, player switches to the real MP4, generating chrome fades out. The user is now simply *in the Studio*.

If the user closes the tab mid-generation: state is in Postgres; reopening the project resumes the same view at the current progress (Workflows keep running server-side).

### Studio

Defined in §1–§2 below (canvas + timeline + history + agent dock).

### Design language — Higgsfield-quality recipes (extracted from their live HTML)

The reference markup shows exactly how that "expensive" look is built. We replicate these as reusable utilities in `globals.css` (mapped to OUR theme tokens, not their lime):

| Recipe | Implementation |
| --- | --- |
| **Floating panel surfaces** | Sidebar/main are CARDS floating on the page, not full-bleed: `m-2 rounded-2xl border border-white/5 bg-[var(--sidebar)]`, content clipped inside. Page bg stays darker than panels |
| **Composer shell** (the prompt input) | `rounded-3xl border border-white/5 bg-[rgb(35_38_42/0.75)]` + diagonal sheen `bg-[image:linear-gradient(124deg,rgba(255,255,255,0.04)_23%,rgba(255,255,255,0.06)_51%,rgba(255,255,255,0.02)_80%)]` + `backdrop-blur-[3.125rem]` + `shadow-[inset_0_2px_3px_0_rgba(255,255,255,0.05),0_2px_4px_-1px_rgba(0,0,0,0.12)]` |
| **Jewel icon chips** | `rounded-[0.625rem] border border-[rgba(197,197,197,0.24)]`, layered bg: two white→transparent vertical gradients (blend `hard-light` + `overlay`) over a brand 135deg gradient pair, `shadow-[0_3.6px_3.6px_rgba(0,0,0,0.08),inset_0_1.8px_3.6px_rgba(255,255,255,0.24)]` |
| **Hero dot grid** | `background-image: radial-gradient(circle, rgba(255,255,255,0.2) 1px, transparent 1px); background-size: 12px 12px` masked by `radial-gradient(ellipse 80% 65% at 50% 16%, …)`; second dot layer revealed under the pointer via `mask: radial-gradient(circle 9rem at var(--pointer-x) var(--pointer-y), …)` — pointer position piped as CSS vars on mousemove |
| **Card caption band** | bottom gradient to `rgba(0,0,0,0.9)` + `mask-image: linear-gradient(to top, #000 50%, transparent)` + `backdrop-blur(12px)` — text always readable over any thumbnail |
| **Card hover** | `hover:scale-[1.015] active:scale-[0.985] transition-transform duration-200 ease-out`, `[clip-path:inset(0_round_1rem)]` to keep GPU-composited rounding |
| **Section fade-outs** | stacked `color-mix(in srgb, var(--background) N%, transparent)` gradient into the page bg |
| **Pills/secondary buttons** | `rounded-full h-8 px-2.5 text-xs font-medium bg-white/5 hover:bg-white/10`, kbd hints `opacity-0 group-hover:opacity-100` |
| **Primary CTA** | accent bg + inner glow `shadow-[inset_-0.25rem_-0.25rem_0.86rem_0_<accent-light>,inset_0_0.25rem_0.25rem_0_rgba(255,255,255,0.25)]` + `border-white/30` + `active:scale-[0.98]` — mapped to our primary token |
| **Signature easing** | `cubic-bezier(0.32,0.72,0,1)` (their sidebar labels, 400ms) for collapse/expand; 150–250ms ease-out for everything else; entrances animate `opacity + blur(0) + transform` together |

**Proof point on motion**: every micro-interaction in that HTML is a CSS transition (`transition-transform duration-200 ease-out`, custom cubic-beziers) — zero JS animation for chrome. That IS the smoothness. Division stands: CSS for UI chrome (these recipes), **Remotion for the video canvas, the generating choreography, and the player timeline** — the frame-based, cinematic surfaces.

### PromptDock spec (from the user-provided reference implementation)

The dock is modeled on a proven AIPanel/AIInputBar/AIDock trio. **In scope: the input bar, the collapsed dock pill, and the status bar. Out of scope (ignore from the reference): the right-side Sheet, the chat panel, fullscreen, mentions, provider/reasoning selectors.**

**Placement rule — the DOCK exists ONLY in the Studio.** Home has NO floating dock: Home renders the **hero composer** — the same input-bar component, inline and centered under the greeting (Higgsfield style), always expanded, no pill/minimize/status-bar behavior. Floating pill + status bar + expand/collapse = Studio only.

**Shell** — `fixed inset-x-0 bottom-0 z-40 flex flex-col items-center px-4 pb-4`, outer `pointer-events-none`, inner `pointer-events-auto w-full max-w-2xl`. Mount/unmount: `opacity 0→1, y 8→0`, 220ms `cubic-bezier(0.32,0.72,0,1)`. Dock⇄Input swap: crossfade 200ms ease-out inside a `layout` container (350ms `cubic-bezier(0.16,1,0.3,1)`). Uses `motion/react` (`AnimatePresence mode='wait'`) — the right tool here per emil (interruptible mount/unmount choreography).

**Input bar** (expanded state):
- Wrapped in **BorderBeam** (`border-beam` pkg, https://beam.jakubantalik.com/) — the animated gradient border. **Only active on `focus-within`** (the reference has it always-on; we gate it). This moving gradient is our **signature effect**, reused elsewhere: scene cards while generating, the active render in History, primary CTA emphasis moments.
- Container: `rounded-2xl border border-border/80 bg-background shadow-md backdrop-blur-xl`, focus-within: `border-primary` + `shadow-[0_18px_90px_hsl(var(--primary)/0.28)]` + `ring-2 ring-primary/35`, transitions 300ms ease-out.
- Top row (in flow, never overlapping the text): window controls right-aligned — minimize button `h-6 w-6 rounded-md text-muted-foreground/40 hover:bg-muted/30 active:scale-[0.94]`.
- **Rotating placeholder**: the real textarea placeholder is empty; an absolutely-positioned motion span rotates through template phrases while input is empty (`opacity/y±6/blur(3px)`, 240ms `cubic-bezier(0.23,1,0.32,1)`, interval ~4s). Home rotates example prompts; Studio rotates agent suggestions.
- Textarea: auto-grow `minHeight 28 → maxHeight 84` (1→3 lines then scroll), `text-[15px] leading-6 caret-primary`, focus via callback ref on mount.
- Bottom row: left slot for future controls, right `PromptInputSubmit h-10 w-10 rounded-xl active:scale-[0.97]` — filled primary when submittable, muted outline otherwise.

**Dock pill** (collapsed/mini state): full-width `rounded-2xl border border-border/80 bg-background px-4 py-3 shadow-md backdrop-blur-xl hover:border-border hover:shadow-lg` button. Content: rotating placeholder (same blur/y crossfade) OR, when a task ran: `taskName · Working ⟳(spin)` / `Complete ✓(emerald)`. Right side: kbd hint (`⌘ K`) `opacity 40%→60% on group-hover`. Click anywhere → expand to input.

**Status bar**: 36px tall, `w-[95%] mx-auto`, slides in above the input while the agent works (height-locked motion, 240ms `cubic-bezier(0.16,1,0.3,1)`); shows the task name + working state; click = expand to the conversation surface (v3).

**New v1 deps this implies**: `motion` (motion/react) + `border-beam` (+ `@dnd-kit` for the timeline). Everything else stays CSS per the motion rules.

**Build rule: AI Elements literally, restyled.** The PromptDock (and every chat surface later) is composed from the installed AI Elements primitives — `PromptInput`, `PromptInputTextarea`, `PromptInputSubmit`, and in v3 `Conversation`/`Message`/`Tool` — exactly like the reference does. We never hand-roll these; we skin them with the design language (classes on top) to get the clean look. Custom components exist only where no AI Elements/shadcn primitive fits (JewelIcon, TemplateCard, timeline blocks).

### Motion rules (applies to every view — emil-design-eng digest)

- UI micro-interactions: **CSS transitions**, transform/opacity only, custom curves (`cubic-bezier(0.23, 1, 0.32, 1)` ease-out), **under 300ms**. Hover effects gated behind `@media (hover: hover) and (pointer: fine)`.
- Entrances: never from `scale(0)` — `scale(0.95–0.97) + opacity 0`; lists stagger 30–80ms; `@starting-style` where possible.
- Pressables: `scale(0.97)` on `:active`, 100–160ms.
- No animation on keyboard-triggered actions. `prefers-reduced-motion`: keep fades, drop movement.
- **Division of labor**: Remotion = the video canvas and choreographed generating sequence (video-domain, long-form, frame-based). CSS/WAAPI = all UI chrome. Do not use Remotion for buttons/hover/layout transitions.

## 1. Concept

One screen — **the Studio** — where a project lives after planning. No page-hopping: canvas in the middle, history on the right, an **agent dock** floating bottom-center. The dock is the power feature: the user talks to an agent that *knows the project* (scenes, characters, locations, assets) and edits it through typed tools — "edit scene 3: make it rain and have the referee smile" → the agent updates the scene prompt, regenerates its keyframes and clip, and the storyboard updates live.

```
┌──┬─────────────────────────────────────────────────────┬──────────┐
│▐ │ Topbar: ← back · title · status · credits · Export  │          │
│▐ ├────────────┬────────────────────────────────────────┤ History  │
│▐ │ Assets &   │                                        │(versions)│
│▐ │ Scenes     │      Player (Remotion, plays draft)    │ v4 ▶ ▪▪  │
│▐ │ · scene    │                                        │ v3   ▪▪  │
│▐ │   list +   │                                        │ v2   ▪▪  │
│▐ │   prompts  │                                        │ v1   ▪▪  │
│▐ ├────────────┴────────────────────────────────────────┴──────────┤
│▐ │ Timeline (FULL bottom width): ruler + scene clip filmstrips —   │
│▐ │ drag & drop reorder, composition only (extensible: cut/trim)    │
└──┴─────────────────────────────────────────────────────────────────┘
                   ╭──── dock chat (floating) ────╮
                   ╰──────────────────────────────╯   ← fixed, bottom-center
                                                        of the PAGE, above all
```

(Reference layout: pro video editors — left media panel, center player, full-width bottom timeline, right context panel.)

- **App rail (far left)**: the global icon-rail sidebar (same as Home).
- **Assets & Scenes panel (left)**: scene list with prompts/dialogue/subtitle text (editable), add/delete scene, characters & locations with their sheets, generated assets browser, and the **Subtitles tab**: style controls (font, size, weight, color, outline, background, position) bound to `projects.subtitle_style` — every tweak previews **live** on the Player overlay. This panel is the manual counterpart of the agent's tools — same services behind both.
- **Canvas (center)**: Remotion `<Player>` playing the **draft timeline** with the **subtitle overlay rendered from `subtitle_style`** (the same object that compiles to ASS at burn time) — real-time subtitle styling. Player dimensions follow the project's aspect ratio (16:9 or 9:16 — vertical projects letterbox the canvas area).
- **Failure states in place**: a failed scene renders as a card with the error reason + **Retry** button (per-scene, never project-fatal); generating scenes show skeleton/progress; empty states designed (no projects, no versions).
- **Timeline (bottom, FULL width)**: spans the entire bottom edge under player and side panels — time ruler + one clip block per scene (keyframe thumbnail filmstrip, duration, status badge). v1 scope: **drag & drop reorder + composition only** — the data model (timeline as data) already supports cut/trim/multi-track later without rework. Render button at the strip's right.
- **History (right)**: version list per `video-engine-architecture.md` §9 — click restores that version's timeline into the draft and shows its MP4.
- **Dock chat (floating, bottom-center of the PAGE)**: `fixed bottom-4 left-1/2 -translate-x-1/2`, layered above the timeline — the SAME PromptInput component as Home with a **mini-bar state**: collapsed = slim pill bar; focus/submit expands the conversation above it (overlay, not a page). Esc collapses back. One component, two contexts (Home = create project, Studio = talk to the project agent).

**Implementation rules**: all video-domain configuration (composition props, fps, durations, timeline↔frames mapping, player config) lives in Remotion — the timeline data drives a data-driven Remotion composition, never ad-hoc `<video>` math. All UI styling via Tailwind utility CLASSES (the design-language recipes become reusable classes in `globals.css`) — no inline style objects except dynamic values (e.g. `--pointer-x`).

## 2. The Studio Agent (chat-driven editing)

### Interaction model

The agent is a **ToolLoopAgent** (AI SDK v7, installed) running server-side, streamed to the dock. It edits the project the same way the UI does — through the existing service layer — so chat and buttons are two front-ends to one behavior. Nothing is agent-only; nothing is UI-only.

Example commands it must handle:

- "edit scene 3: it should be raining and the referee smiles" → `updateScene` (prompt) → `regenerateSceneAssets`
- "swap scenes 2 and 4" → `reorderScenes` (draft timeline)
- "the goalkeeper looks wrong, redo his character sheet with a green kit" → `updateCharacter` + `regenerateCharacterSheet` (cascades: affected keyframes flagged stale)
- "make scene 5 shorter, like 5 seconds" → `updateScene` (duration)
- "add a scene after 6 where the crowd goes silent" → `addScene` (agent writes the prompt in-style using the style/location bibles)
- "render it" → `renderVersion`

### How the agent knows the project

1. **Context injection**: the chat route loads a compact project snapshot (id, title, style bible summary, scenes list `{ index, id, title, status, durationSeconds, locationKey, characters }`, characters, locations, credit balance) into the system prompt per request. Small, cheap, always current.
2. **Read tools** for anything deeper: `getScene(sceneId)` returns full prompt/dialogue/asset refs on demand.

### Tool catalog (each tool = thin wrapper over an existing oRPC service)

| Tool | Effect | Cost class |
| --- | --- | --- |
| `getScene`, `listAssets` | read | free |
| `updateScene` (prompt/dialogue/duration/title) | db write, marks scene assets stale | free |
| `reorderScenes`, `addScene`, `removeScene` | draft timeline / scenes write | free |
| `updateCharacter`, `updateLocation` | db write, flags dependents stale | free |
| `regenerateKeyframe(sceneId, notes)` | gpt-image-2 task | cheap — auto-run |
| `regenerateCharacterSheet(characterId, notes)` | gpt-image-2 task + stale cascade | cheap — auto-run |
| `regenerateSceneVideo(sceneId)` | Seedance task | **expensive — requires user confirmation** |
| `renderVersion()` | assembly + new version | **expensive — requires user confirmation** |

**Confirmation policy**: free/cheap tools execute directly. Credit-burning tools use the AI SDK tool-approval flow — the tool call streams to the client, AI Elements renders it as a confirmation card (cost estimate + Run/Cancel), `addToolResult` resumes the loop. The agent can *propose* a batch ("this changes scenes 2, 3 and 5 — regenerate all three? ~N credits") and the user approves once.

### Streaming stack

- **Server** (`apps/server`): `POST /api/agent/chat` (Hono route) → `ToolLoopAgent` with the tool set + project context → `createAgentUIStream`/`toUIMessageStreamResponse`. Tools call services; services already own db + kie + workflow logic. Long generations are NOT awaited in-chat: the tool creates the generation/workflow and returns immediately ("scene 3 keyframe regenerating"); progress arrives through the normal storyboard polling/invalidation.
- **Client** (dock): `useChat` from `@ai-sdk/react` + AI Elements. After any mutating tool result → invalidate the project queries → canvas/storyboard/timeline re-render. The chat never holds state the db doesn't.

## 3. Component map (everything already installed — reuse, don't build)

| UI piece | Components |
| --- | --- |
| Nav rail | `sidebar` (SidebarProvider/Sidebar/SidebarMenu), `tooltip` |
| Topbar | `breadcrumb`, `badge` (status), `button`, `dropdown-menu` (project actions), `skeleton` |
| Player area | `@remotion/player` inside `card`/`aspect-ratio`; `slider` for scrub if needed |
| Timeline strip | `scroll-area` (horizontal), `card` per scene, `badge` (scene status), `context-menu` (scene actions), `alert-dialog` (delete scene), dnd via native drag or `@dnd-kit` (only new dep, add if needed) |
| History panel | `sheet` (or fixed column) + `scroll-area`, `item`/`card` rows, `badge` (rendered/failed), `separator` |
| Agent dock (collapsed) | AI Elements `prompt-input` (PromptInput, PromptInputTextarea, PromptInputSubmit) inside a floating `card` — Knock-style rounded pill |
| Agent dock (expanded) | AI Elements `conversation`, `message`, `response`, `tool` (tool-call cards), `confirmation`/tool-approval card, `loader`, `suggestion` (chips: "Regenerate scene…", "Swap scenes…", "Render") |
| Generation progress | `progress` + `badge` on scene cards; `sileo` toasts (via `libs/toast`) for terminal events (scene ready/failed) |
| Storyboard page | `card` grid (keyframe, prompt excerpt), `dialog` for scene detail/edit, `textarea`, `field` for forms |
| Assets page | `table` or card grid + `dialog` preview, existing signed-URL download |
| Credits/limits | `badge` in topbar + `tooltip`; `alert` when balance low |

Styling rules: semantic tokens only (`bg-background`, `text-muted-foreground`), radix-nova theme as configured, `flex gap-*` spacing, no custom one-off components where an installed one exists (shadcn skill rules apply).

## 4. Routes & feature structure (follows repo architecture)

```
app/(private)/
  page.tsx                          # Home: greeting hero + prompt + template cards + recent projects
  projects/[projectId]/page.tsx     # Studio (SSR: session + project prefetch; generating state included)

feature/home/
  views/    home-view.tsx
  components/ prompt-hero.tsx, template-card.tsx, template-card-fan.tsx
  hooks/    use-template-ghost.ts   # hover→ghost-text→commit interaction state

feature/studio/
  views/    studio-view.tsx, storyboard-view.tsx, assets-view.tsx
  components/ player-canvas.tsx, timeline-strip.tsx, scene-card.tsx,
              history-panel.tsx, agent-dock.tsx
  hooks/    use-draft-timeline.ts   # draft state + undo/redo stack (client)
  queries/  use-project.ts, use-scenes.ts, use-versions.ts, use-generations.ts

feature/projects/
  views/    project-list-view.tsx, create-project-view.tsx
  queries/  use-projects.ts
```

- Server state: tanstack-query via the existing oRPC utils (polling on active generations; invalidation after agent tools/mutations).
- Client state: one small store for `draftTimeline` + undo/redo stack (array of snapshots) + dock open/closed. No global state framework needed.

## 5. Contract additions (packages/api)

- `agent.chat` stays a plain Hono streaming route (UI message stream isn't an oRPC shape); everything else the agent touches is contract procedures: `projects.*`, `scenes.*` (update/reorder/add/remove/regenerate), `characters.*`, `versions.*` — shared by dock tools and buttons.
- Chat history: MVP keeps it client-side per session (the durable record is the project state + versions). A `agent_messages` table is a v2 nice-to-have, not core.

## 6. Release plan — v1 / v2 / v3 (the delivery order)

UI first, pipeline second, agent third. Every version is shippable and demo-able.

### v1 — UI base + shells (all visual, mock/local data)

1. App shell from `dashboard-01`: icon-rail sidebar, floating-panel surfaces, design-language utilities in `globals.css` (composer shell, jewel chips, hero dots, card recipes, easings).
2. **Reusable component kit**: `PromptDock` per the spec above (input bar + dock pill + status bar; BorderBeam on focus), `JewelIcon`, `TemplateCard` (+ fan), panel surfaces, timeline clip block. Deps: `motion`, `border-beam`, `@dnd-kit`.
3. **Login page** (reskin of existing auth): centered composer-shell card over the dot grid, sign in ⇄ sign up toggle, email+password only, shared zod schemas untouched.
4. Home: greeting hero + dot grid, PromptDock in hero mode, 4 sport template cards with hover-fills-input, recent projects grid.
5. Studio shell: left Assets & Scenes panel, center Remotion Player, bottom timeline (dnd reorder + composition only), right History panel, PromptDock as mini bar. Generating-state skeletons included.
6. Gate: every screen navigable with mock data (login → home → studio); motion follows the design language; check-types + build green.

### v2 — core pipeline (the product works end-to-end)

1. Domain: types enums + db schema (projects/characters/locations/scenes/assets/generations/project_versions) + repositories/services/contracts — **user_id isolation enforced in the repository layer from day one**.
2. Plan agent (3-scene initial plan, language handling incl. prompt-override) + `packages/kie` adapter + webhook route.
3. `VideoGenerationWorkflow`: sheets → keyframes → 3 scene clips → TTS dialogue audio → R2 ingest; live progress filling the v1 skeletons; **per-scene failure states + Retry** (never project-fatal).
4. Versions + render: draft timeline persisted (single ordering authority), `versions.create`; **R1** browser Mediabunny assembly (no subs) → then **R2 canonical**: Containers ffmpeg with **subtitle burn-in + audio mix** — every version ships with styled subtitles.
5. Subtitles in Studio: subtitle text per scene + `subtitle_style` editor with live Player preview.
6. **Extend-story loop**: add scene (manual button) → agent extends plan by one scene → chained generation → appended to timeline.
7. Gate: prompt → 3-scene anime video with Japanese voice + styled English subs burned in, downloadable; failed scenes retryable; both aspect ratios work.

### v3 — agent editing (the dock comes alive)

1. Dock agent (ToolLoopAgent) streaming via AI Elements: read tools + free write tools (updateScene, reorderScenes, addScene, removeScene) — "crea otra escena en la cual X y Y" works; left panel and chat stay in sync (same services).
2. Generation tools with confirmation cards (regenerateKeyframe auto, regenerateSceneVideo/render gated).
3. Polish: suggestion chips, progress badges, credit guardrails.
4. Gate: chat-driven scene creation/edit/delete round-trips into the timeline and versions without breaking v1/v2 behavior (everything stays compatible — assets immutable, timeline as data).
