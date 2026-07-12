# Realtime status (SSE) + first-version loading + render lock — v1

Status: **agreed direction** (2026-07-12). Companion to `video-engine-architecture.md`
and `ai-architecture-v1.md`. Owner call: replace the 2.5s status **poll** with a
pushed **SSE** channel, add a **first-version-only** glass loading gate over the
studio, and harden the **export/render lock** so a new version can never be
kicked while anything is still generating.

Grounded in the pipeline audit (2026-07-12): status is 100% polling today; there
is no SSE anywhere except the agent chat stream. Generation is already
fire-and-forget (create/extend kick a Cloudflare Workflow and the HTTP returns
immediately). Placeholder scenes already appear in the timeline as `planned` and
flip to `video_ready`. The render already muxes every clip + burns subtitles +
passes baked audio. This doc only adds the realtime transport, the first-version
gate, and the render-lock hardening.

---

## 1. SSE status channel (replaces the poll)

### Why a Durable Object
On Cloudflare Workers a plain `fetch` handler cannot hold a long-lived
connection; the correct primitive for server→client push is a **Durable
Object**. One DO instance **per project** owns the connected `EventSource`
clients and fans out status events. The generation Workflow (already running in
the worker) notifies that DO after every status transition it already writes to
Postgres.

Postgres stays the source of truth. The DO is a **fan-out relay only** — it holds
no authoritative state; a client that connects late does one REST fetch of
`projects.get` for the current snapshot, then receives deltas.

### Pieces

1. **`ProjectEventsDO`** (new Durable Object, in `apps/server`):
   - `fetch()` upgrades a request to an SSE response and registers the writer
     (keep a `Set<WritableStreamDefaultWriter>`; drop on close/error).
   - `broadcast(event)` — internal RPC method (called via stub) that writes the
     event to every registered writer as `data: <json>\n\n`. No-op if no
     subscribers (the common case — nobody watching).
   - Heartbeat: emit a `: ping\n\n` comment every ~25s so intermediaries don't
     drop idle connections; on write error, evict that writer.
   - Bounded: cap subscribers per project (e.g. 20) — reject beyond it.

2. **Binding + IaC** (`packages/infra/alchemy.run.ts`): add the DO namespace +
   binding (`PROJECT_EVENTS`) and a migration entry, mirroring the existing
   `VIDEO_GENERATION_WORKFLOW` binding shape. Export the DO class from the worker
   entry.

3. **SSE route** (`apps/server/src/index.ts`): `GET /projects/:projectId/events`.
   - Auth: same session extraction as `/agent/:projectId/chat` (401 if none).
   - Ownership: verify the caller owns `projectId` (reuse `withUser` +
     `projectRepository.findById`) **before** subscribing — 404 on miss. Never
     hand a client a stream for a project it can't read.
   - `Response` is `text/event-stream`; forward to
     `env.PROJECT_EVENTS.get(idFromName(projectId)).fetch(...)`.
   - CORS: covered by the existing blanket `cors()` with credentials, same as
     `/agent`.

4. **Workflow → DO notify** (`apps/server/src/services/generation.service.ts` +
   `workflows/video-generation.ts`): after each transition already persisted —
   `markProjectPlanning/Generating`, `markSceneKeyframePending/Ready`,
   `markSceneVideoPending`, `ingestSceneVideo` (→ `video_ready`),
   `markSceneFailed`, `finalizeProject` — call the project's DO stub
   `.broadcast({ type, projectId, sceneId?, sceneStatus?, projectStatus? , at })`.
   Wrap each notify in try/catch: **a broadcast failure must never fail
   generation** (the DB write already succeeded; the client's fallback poll — §1
   client — still reconciles).

5. **Event shape** (keep it a thin delta, not the full ProjectDetail):
   ```ts
   type ProjectEvent =
     | { type: "scene"; projectId: string; sceneId: string; status: SceneStatus }
     | { type: "project"; projectId: string; status: ProjectStatus }
     | { type: "version"; projectId: string; versionId: string; status: VersionStatus };
   ```
   Contract lives in `packages/api` (a zod schema, so both sides share it). The
   render path (`version.service.markRendered` / `cancel`) also broadcasts
   `version` events so History updates live too.

6. **Client** (`apps/web/src/feature/studio/hooks/http/use-project.ts` + a new
   `use-project-events.ts`):
   - Open an `EventSource` to `/projects/${projectId}/events`
     (`withCredentials`) while mounted; close on unmount / project change.
   - On each event: **targeted** update, not a full refetch. A `scene` event →
     patch that scene's status in the draft store (and, when it becomes
     `video_ready`, let the existing `applyServerSnapshot` path pull the asset —
     simplest v1: on a `video_ready`/`failed`/`project`/`version` event, call
     `queryClient.invalidateQueries(projects.get)` **once** so the existing
     reconcile runs; optimize to true field-patching later).
   - **Fallback poll**: keep `refetchInterval` but slow it to ~15–20s and only
     while active, as a safety net if the SSE drops (mobile background, proxy).
     SSE is the fast path; the slow poll guarantees eventual consistency.
   - Reconnect: `EventSource` auto-reconnects; on `error` just let it, and do one
     `invalidateQueries` on reopen to catch anything missed.

### Non-goals for v1
No Postgres `LISTEN/NOTIFY` (awkward on serverless PG), no replacing the DB as
source of truth, no per-field delta patching yet (invalidate-on-event is the
v1). The DO is a relay; if it's ever unavailable the slow poll still works.

---

## 2. First-version loading gate (glass overlay)

Block the studio behind a frosted overlay **only** the very first time a project
generates — never for extend/retry.

- **Predicate** (no new DB flag needed): a project is in its first generation ⇔
  `isProjectActive(project) && !scenes.some(s => s.status === "video_ready")`.
  `extend` is only allowed on a `ready` project (which by definition already has
  ≥1 `video_ready` scene), so this is `true` exclusively during the first run and
  lifts the instant the first scene lands — or when the project first reaches a
  terminal status.
- **Component** (`apps/web/src/feature/studio/components/first-run-overlay.tsx`):
  an absolutely-positioned layer over `StudioViewInner`'s editor region using the
  **same glass treatment as the AI input** (`glass-composer`/`glass-edge`
  utilities) so the timeline + player animate visibly underneath in real time
  while all interaction is blocked (`pointer-events` on the overlay, editor
  region `inert` or `aria-hidden` + `pointer-events-none`). Content: a compact
  status line driven by the live project/scene status ("Planning the story…",
  "Generating keyframes…", "Rendering scene 2 of 3…") + a calm indeterminate
  progress. Honor `prefers-reduced-motion`.
- Gate it in `StudioViewInner`; it reads status the SSE channel now pushes, so
  the copy updates live. Dismisses automatically — no user action.
- Failure case: if the first generation ends `failed` (no scene ever reached
  `video_ready`), the overlay must resolve to an error state with a Retry, not
  hang forever (predicate becomes false at terminal status — surface the failure
  rather than silently revealing an empty studio).

---

## 3. Render / export lock (safety)

Owner rule: **no export to a new version while anything is still
generating/rendering**, and **export only the current language exactly as it
sits in the scenes**.

### Current state
- Client `canRender` already requires `orderedScenes.every(video_ready)`
  (`use-render-export.tsx:170`), and `validateTimelineReady` throws
  `SceneNotReadyError` before any mux. ✅
- Server `version.service.render` guards **one concurrent render**
  (`findRenderingByProjectId` → `CONFLICT`) + rate limit. ✅
- **GAP**: `version.service.render` does **not** check that the project is
  `ready` / that every scene is `video_ready`. So the agent's `render_version`
  tool, or a direct API call, can create a `rendering` version while scenes are
  mid-generation. The client export would then fail preflight, but the server
  state is already inconsistent.

### Fix
- **Server guard** in `version.service.render` (inside the existing guarded
  transaction, before creating the `rendering` row): reject with `CONFLICT`
  (message: "Finish generating all scenes before rendering a version.") when the
  project status is not `ready`, **or** any scene is not `video_ready`. This is
  the real safety net — it closes the agent-tool and direct-API paths, not just
  the button. Add a bun:test for: all-ready → allowed; one scene pending →
  CONFLICT; a render already running → CONFLICT (unchanged).
- **Agent tool**: `render_version`'s execute already catches `ORPCError` and
  returns `{ started: false, error }` — the new CONFLICT flows through as a
  graceful "can't render yet" the model can relay. No extra change.
- **Current-language only**: no code change — the export already burns each
  scene's single `subtitleText` (authored in the project's `subtitleLanguage`).
  Explicitly do **not** add an export-time language selector. Document this in
  `export.ts`'s header comment so it stays intentional.

---

## 4. Phasing

| Phase | Scope |
| --- | --- |
| RT-1 | Render-lock hardening (§3 server guard + test) + current-language doc note. Cheap, independent, ship first. **Done** — `lib/render-guard.ts`'s `canRenderProject` wired into `version.service.ts::render`, 9 bun:test cases, `export.ts` header note added. |
| RT-2 | First-version glass overlay (§2). Frontend-only, reads existing status. **Done** — `lib/first-run.ts` predicates + `components/first-run-overlay.tsx`, gated in `StudioViewInner` (studio-view.tsx), polling-driven (no SSE dependency). |
| RT-3 | SSE via Durable Object (§1): DO + binding + route + workflow notify + `packages/api` event schema + client `EventSource` + slow fallback poll. Largest; replaces the 2.5s poll as the fast path. **Done** — `ProjectEventsDO` (apps/server/src/durable/project-events.ts) wraps `lib/project-events-registry.ts`'s pure add/remove/broadcast/heartbeat bookkeeping (bun:test-covered); `PROJECT_EVENTS` DO namespace + binding in `packages/infra/alchemy.run.ts` (alchemy 0.93's native `DurableObjectNamespace`, no explicit migration entry needed — alchemy manages that internally); `GET /projects/:projectId/events` in `apps/server/src/index.ts` (session + ownership, mirrors `/agent/:projectId/chat`); `packages/api`'s `projectEventSchema` (discriminated union, bun:test-covered) shared by server (`lib/notify-project-event.ts`, called from `generation.service.ts`'s status-transition functions and `version.service.ts::markRendered`/`cancel`, every call after its transaction committed and wrapped in try/catch) and client (`use-project-events.ts`); `use-project.ts`'s fallback poll slowed 2.5s → 20s. The DO class itself (imports `cloudflare:workers`) is not bun-testable and needs a live worker to verify end-to-end — see the RT-3 implementation report for what's unit-tested vs needs-live-verification. |

RT-1 and RT-2 have no dependency on RT-3 and can land immediately; RT-3 makes the
overlay copy and the timeline update instant instead of ≤2.5s-late.

## 5. Open questions
- DO event payload: invalidate-on-event (v1) vs true field-patching (v-next) —
  start with invalidate, measure.
- Should the slow fallback poll be disabled entirely once an SSE connection is
  confirmed healthy? v1: keep it at ~20s for resilience.
