# media-ops — ffmpeg on Cloudflare Containers (docs/media-ops-container.md §1).
#
# Two-stage build, run from the REPO ROOT as build context (see
# packages/infra/alchemy.run.ts's `mediaOps` Container() `build.context` /
# `build.dockerfile`, and Dockerfile.dockerignore next to this file for what
# stays out of that context):
#
#   docker build -f containers/media-ops/Dockerfile .
#
# `containers/media-ops` is a bun workspace member whose deps (fastify, tsx,
# zod) are pinned through the monorepo's `catalog:` protocol in the root
# package.json — npm cannot resolve that protocol, so this image can no
# longer `npm install` standalone from its own directory. The `deps` stage
# below builds with `oven/bun` against the whole repo (bun needs the root
# package.json + lockfile + every workspace's package.json to resolve the
# catalog and this package's workspace membership), then only that stage's
# resolved `node_modules` for THIS package is copied forward. Two flags matter:
#   --filter '@video-platform-challenge/media-ops' — scopes the actual install
#     (and any lifecycle/postinstall scripts) to this package's own dependency
#     subtree, so unrelated workspace members' native deps (e.g. better-sqlite3
#     elsewhere in the monorepo, which needs node-gyp/Python this image doesn't
#     have) never get built.
#   --linker=hoisted — bun's default "isolated" linker leaves
#     containers/media-ops/node_modules full of symlinks into a central
#     node_modules/.bun store OUTSIDE that directory, which breaks once only
#     that one directory is copied into the runtime stage below. "hoisted"
#     produces a normal, self-contained (real files) node_modules tree, same
#     shape `npm install` used to produce here.
# The runtime stage is unchanged in spirit from the original single-stage
# build: node:22-alpine + ffmpeg + `tsx server.ts`, no npm/bun installed at
# runtime, so the final image stays slim.
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY . .
RUN bun install --filter '@video-platform-challenge/media-ops' --frozen-lockfile --linker=hoisted

FROM node:22-alpine
# Alpine's ffmpeg has libmp3lame (mp3 encode) and TLS (https input) — all
# this server shells out to.
RUN apk add --no-cache ffmpeg

WORKDIR /app
# `--filter` scopes install to media-ops's own dependency subtree, and with
# nothing else in that subtree to conflict on version, `--linker=hoisted`
# hoists the whole resolved tree to the workspace ROOT node_modules rather
# than nesting it under containers/media-ops/ — hence copying from there.
COPY --from=deps /repo/node_modules ./node_modules
COPY containers/media-ops/server.ts containers/media-ops/env.ts ./

# The Cloudflare Container maps to this port (MediaOpsContainer.defaultPort).
# The server reads process.env.PORT and falls back to 8080.
EXPOSE 8080
CMD ["npx", "tsx", "server.ts"]
