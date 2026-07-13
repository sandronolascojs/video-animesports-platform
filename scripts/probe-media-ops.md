# Probe: media-ops container (THROWAWAY — Phase 0 validation only)

Delete this file once Phase 1 wires last-frame chaining on top of the container.
It exists only to prove a frame + audio extraction works end-to-end before we
build features on the container. There is **no public unauthenticated route** —
you validate by talking to the container image directly, or by deploying and
exercising `apps/server/src/lib/media-ops.ts` from a trusted server context.

The server inside the image (`containers/media-ops/server.mjs`) is a plain HTTP
server with three routes:

- `GET  /`              -> `200 ok` (health)
- `POST /extract-frame` `{ videoUrl, atSeconds? }` -> `image/jpeg` bytes
- `POST /extract-audio` `{ videoUrl, format? }`    -> `audio/mpeg` bytes

`videoUrl` must be a **publicly fetchable** http(s) URL (ffmpeg reads it as an
http input). In production that's an R2 **signed** URL; for a raw probe any
public mp4 works.

## Option A — local Docker (fastest; needs Docker Desktop running)

Docker is NOT running by default in this environment. Start Docker Desktop, then
from the repo root:

```sh
# 1. Build the image
docker build -t media-ops ./containers/media-ops

# 2. Run it (maps container 8080 -> host 8080)
docker run --rm -p 8080:8080 media-ops

# 3. In another shell — health check
curl -s http://localhost:8080/            # -> ok

# 4. Extract the last frame of a public mp4 -> frame.jpg
curl -s -X POST http://localhost:8080/extract-frame \
  -H 'content-type: application/json' \
  -d '{"videoUrl":"https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"}' \
  --output frame.jpg
file frame.jpg          # -> JPEG image data
open frame.jpg          # (macOS) eyeball it — should be the LAST frame

# 5. Extract audio -> out.mp3
curl -s -X POST http://localhost:8080/extract-audio \
  -H 'content-type: application/json' \
  -d '{"videoUrl":"https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"}' \
  --output out.mp3
file out.mp3            # -> MPEG ADTS, layer III / MP3 audio
```

### Expected failure modes (all correct behavior)

- Non-URL / non-http(s) `videoUrl` -> `400 videoUrl must be an http(s) URL string`
  (validated before ffmpeg is ever spawned; args are passed to `spawn` as an
  array, never a shell string, so there is no shell-injection surface).
- Unreachable / non-video URL -> `500` with the tail of ffmpeg's stderr (ffmpeg
  exits non-zero before writing any stdout, so the status line is still ours).

## Option B — on deploy (no local Docker)

```sh
bun run deploy          # alchemy builds the Dockerfile, pushes it, binds MEDIA_OPS
```

The container has no public route of its own — it is only reachable through the
`MEDIA_OPS` binding from the `server` Worker. To exercise it end-to-end, add a
TEMPORARY trusted-context call (e.g. from a one-off script or an authenticated
admin-only handler you remove afterward) that does:

```ts
import { extractLastFrame, extractAudio } from "@/lib/media-ops"; // apps/server
const frame = await extractLastFrame(signedVideoUrl); // Uint8Array (jpeg)
const audio = await extractAudio(signedVideoUrl);     // Uint8Array (mp3)
```

Assert both return non-empty `Uint8Array`s and that `frame` starts with the JPEG
magic bytes `FF D8 FF`. Do NOT ship a public unauthenticated route to do this —
remove the probe call once validated. Phase 1 (`generation.service`) is the real
first consumer.
