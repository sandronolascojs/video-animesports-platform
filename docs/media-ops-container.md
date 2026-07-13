# media-ops container — ffmpeg on Cloudflare Containers

Owner call 2026-07-13. A shared, on-demand, scale-to-zero Cloudflare Container
running **ffmpeg** — the one piece of infra that unblocks BOTH:

1. **Last-frame extraction** → last-frame chaining (clip-to-clip coherence).
2. **Audio extraction** → kie STT → **perfect subtitle sync** (subtitles sit exactly
   over the spoken dialogue).

Cloudflare Containers auto-sleep when idle (`sleepAfter`), so this is pay-per-use and
scales on demand — no always-on box. alchemy builds + pushes the image on deploy.

## Why a container (decision record)

- ffmpeg cannot run in a Worker: workerd blocks runtime WASM compilation, has no
  threads/SharedArrayBuffer, 128MB isolate + 10MB bundle caps, no native binaries,
  no `child_process` spawn. (See docs/last-frame-chaining.md "rejected" section.)
- CF Media Transformations `env.MEDIA` binding is not modeled by alchemy (verified).
- Whisper via AI Gateway CAN transcribe an mp4 directly (proven: returns `Not this
  time! [0.00-1.56]`), so STT alone would not need a container — but the container is
  chosen deliberately to unblock last-frame extraction too and keep one clean,
  scalable media-ops layer (owner call). Gateway-whisper stays as a documented fallback.

## Architecture

### 1. The container image — `containers/media-ops/`

- **Dockerfile**: `node:22-slim` (or `oven/bun`), `apt-get install -y ffmpeg`, copy
  `server.ts`, `CMD` runs the HTTP server on `PORT` (default 8080).
- **server.ts** — a tiny HTTP server (Bun.serve or node:http). ffmpeg reads the signed
  R2 URL directly as an http input and writes the result to stdout (`pipe:1`):
  - `POST /extract-frame` `{ videoUrl, atSeconds? }` → `image/jpeg` bytes.
    `ffmpeg -sseof -${atSeconds ?? 0.1} -i <videoUrl> -frames:v 1 -q:v 2 -f image2 pipe:1`
    (`-sseof -0.1` seeks from the END → the real last frame).
  - `POST /extract-audio` `{ videoUrl, format? = "mp3" }` → `audio/mpeg` bytes.
    `ffmpeg -i <videoUrl> -vn -acodec libmp3lame -f mp3 pipe:1`
  - `GET /` → `200 ok` (health).
- Stateless + dumb: it only shells ffmpeg. No R2 creds, no business logic — the Worker
  owns R2 and orchestration. Keeps the image tiny, fast, and horizontally scalable.

### 2. The Container class — `apps/server/src/durable/media-ops-container.ts`

```ts
import { Container } from "@cloudflare/containers";
export class MediaOpsContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";   // scale to zero when idle
}
```
Re-exported from `apps/server/src/index.ts` (same mechanism as `VideoGenerationWorkflow`
and `ProjectEventsDO` — alchemy resolves it by `className` off the compiled script).

### 3. alchemy wiring — `packages/infra/alchemy.run.ts`

```ts
import { Container } from "alchemy/cloudflare";
export const mediaOps = await Container("media-ops", {
  className: "MediaOpsContainer",
  build: { context: "../../containers/media-ops" },
  instanceType: "basic",
  maxInstances: 5,
  dev: { remote: false }, // local build via Docker; remote build on deploy
});
// server Worker bindings: { …, MEDIA_OPS: mediaOps }
```
- Add `@cloudflare/containers` to `apps/server` deps.
- **Deploy**: alchemy builds the Dockerfile → pushes to the CF container registry.
- **Local dev**: uses the local Docker daemon (`cloudflare-dev/` image) — **Docker Desktop
  must be running** (it is NOT currently). Without Docker, validate via `alchemy deploy`.

### 4. Worker access — `apps/server/src/lib/media-ops.ts`

```ts
import { getContainer } from "@cloudflare/containers";
async function call(path: string, body: unknown): Promise<Uint8Array> {
  const c = getContainer(env.MEDIA_OPS, "media-ops"); // one warm pool; id per-scene for parallelism
  const res = await c.fetch(new Request(`http://c${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error(`media-ops ${path} ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
export const extractLastFrame = (videoUrl: string) => call("/extract-frame", { videoUrl });
export const extractAudio = (videoUrl: string) => call("/extract-audio", { videoUrl });
```

## Feature 1 — last-frame chaining

- `generation.service.extractAndStoreLastFrame({ userId, projectId, sceneId, videoAssetId, durationSeconds })`:
  sign the video URL → `extractLastFrame` → `putObject` (jpeg) → insert a READY `keyframe`
  asset → return its id.
- `video-generation.ts` project-generation video phase becomes **sequential**: thread
  `chainedFirstFrameAssetId` — scene i's first frame = the real last frame of V_{i-1}
  (or its own start keyframe K₁ for scene 1 / on extraction failure). Drop the forced
  `last_frame_url` so seedance animates ONE natural action (best physics).
- `packages/kie/src/video.ts`: make `lastFrameUrl` optional; omit when absent.
- **Tradeoff**: sequential video (V_{i+1} needs V_i's frame) → loses the concurrent phase.
  Coherence chosen over speed (owner call). Extension/retry modes chain the same way.

## Feature 2 — subtitle STT sync

- After video ingest: `extractAudio(videoUrl)` → upload the mp3 to R2 (short-lived) → sign →
  **kie `elevenlabs/speech-to-text`** (authorized; returns word-level timestamps) with the
  audio URL → real speech timings.
- Persist on the scene: `scenes.speechCues jsonb` = `[{ text, startSeconds, endSeconds }]`
  (or minimally `speechStartSeconds`/`speechEndSeconds`). New migration.
- `apps/web/.../subtitle-cues.ts`: when the scene carries real `speechCues`, use them
  verbatim; otherwise fall back to the current word-count estimate. Player + export both
  read the same cues, so the subtitle appears exactly on speech and clears on silence.
- Fallback: AI Gateway `whisper-1` on the mp4 directly (segment timestamps, no extraction).

## Feature 3 — delete project + R2 cleanup (independent of the container)

- `packages/storage`: `deleteObjectsByPrefix(prefix)` — S3 `ListObjectsV2` + batched
  `DeleteObjects` under `users/{userId}/projects/{projectId}/`.
- `project.service.remove`: after the DB cascade delete, call `deleteObjectsByPrefix` for
  the project so no orphaned R2 objects remain.
- Web: enable **Delete** in the projects sidebar dropdown (remove the "Coming in v2" tag),
  wire it to a confirm dialog → `projects.delete`.

## Rollout (phased, each validated before the next)

- **Phase 0**: container image + class + alchemy binding + `lib/media-ops.ts` + a throwaway
  probe route. Validate a frame + audio extraction end-to-end (deploy, or local w/ Docker).
- **Phase 1**: last-frame chaining (kie first-frame-only, extraction, sequential video phase).
- **Phase 2**: subtitle STT sync (audio → kie STT → cues → player/export).
- **Phase 3**: delete + R2 cleanup.

## Risks

- **Docker for local dev** (not running now) — else validate on deploy.
- ffmpeg http input needs an https-capable build (`node:slim` + apt ffmpeg has it); if a
  signed URL misbehaves, fetch bytes → ffmpeg stdin instead.
- Container cold start (~seconds) on first call after idle; `sleepAfter` scales to zero.
- Sequential video (Feature 1) is slower than the concurrent phase.
