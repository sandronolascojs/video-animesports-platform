# video-platform-challenge

An AI sports-anime video generator. A user describes a moment — *"a last-minute
winning goal"* — and the app plans an episode, generates anime keyframes and
video clips, and assembles them into a playable, exportable timeline, editable
by an in-app agent.

Bun workspaces + Turborepo monorepo, deployed to Cloudflare via Alchemy.

## Stack

- **Frontend** — Next.js (App Router), oRPC client + TanStack Query, Tailwind v4
  + shadcn/ui, Zustand. Remotion `<Player>` for preview, in-browser export via
  mediabunny.
- **Backend** — oRPC on Cloudflare Workers (Hono for the raw `/rpc`, `/agent`,
  and webhook routes), layered `router → service → repository`. A Durable Object
  for realtime status (SSE), a Workflow for the multi-step generation pipeline,
  and a Container (ffmpeg) for last-frame / audio extraction.
- **Data** — PostgreSQL (Neon) + Drizzle ORM. Cloudflare R2 for media, kept
  private and served through short-lived signed URLs.
- **Auth** — better-auth (signed cookie session).
- **AI** — Vercel AI SDK + AI Gateway (the plan/studio agents and whisper
  subtitle transcription); kie.ai for `gpt-image-2` keyframes and
  `seedance-2-mini` video.
- **Infra** — Alchemy (`packages/infra/alchemy.run.ts`): Worker, Next.js, R2,
  Durable Object, Workflow, Container.
- **Tooling** — Biome, Husky, TypeScript, Turborepo.

## Structure

```
apps/
  web/          Next.js frontend
  server/       oRPC API on Cloudflare Workers (router/service/repository, DO, Workflow, Container binding)
packages/
  types/        shared enums + constants + the pagination contract (zod)
  api/          THE contract: zod schemas + oRPC contract — web and server both depend on it
  db/           Drizzle schema + db instance (Neon)
  auth/         better-auth setup
  storage/      R2 signed-URL library
  kie/          kie.ai provider adapter (gpt-image-2, seedance)
  ai/           AI foundations: agents, prompt registry, model runtime
  env/          typed env access
  infra/        Alchemy deploy definition
  config/       shared TS / tooling config
containers/
  media-ops/    Fastify + ffmpeg container (last-frame extraction, audio)
```

Package import rules (what may depend on what) live in [`CLAUDE.md`](./CLAUDE.md).

## Getting started

1. Install dependencies:
   ```bash
   bun install
   ```
2. Create each project's env from its template and fill in the values
   (see **Environment** below):
   ```bash
   cp apps/server/.env.example        apps/server/.env
   cp apps/web/.env.example           apps/web/.env
   cp containers/media-ops/.env.example containers/media-ops/.env
   ```
3. Push the schema to your database:
   ```bash
   bun run db:push
   ```
4. Run everything:
   ```bash
   bun run dev
   ```
   Web → <http://localhost:3001> · API → <http://localhost:3000>

`bun run dev` runs `alchemy dev`, which also boots the R2 bucket, Durable
Object, Workflow, and the media-ops Docker container locally in Miniflare.

> Editing server code mid-generation restarts the local Worker and kills any
> in-flight generation workflow — let a run finish, or retry it from the Studio.

## Environment

Each project keeps its own `.env.example`. Copy it to `.env` and fill it in.

- **`apps/server/.env`** — Postgres, auth, kie.ai, AI Gateway, and the shared
  `MEDIA_OPS_SECRET`. R2 credentials are **not** here: Alchemy provisions them,
  and the Worker's `VIDEO_STORAGE` / `PROJECT_EVENTS` / `MEDIA_OPS` bindings are
  Alchemy bindings, not env vars.
- **`apps/web/.env`** — `NEXT_PUBLIC_SERVER_URL`.
- **`containers/media-ops/.env`** — port + `MEDIA_OPS_SECRET` (must match the
  server's; injected by the Worker at runtime locally, supplied by the CI secret
  on deploy).

## Scripts

- `bun run dev` — all apps in dev (Alchemy + Next.js + Miniflare + container).
- `bun run dev:web` / `bun run dev:server` — a single app.
- `bun run build` — build everything.
- `bun run check-types` — typecheck every package.
- `bun run test` — run tests.
- `bun run check` — Biome format + lint (`--write`).
- `bun run db:push` / `db:generate` / `db:migrate` / `db:studio` — Drizzle.
- `bun run deploy` / `deploy:dev` / `destroy` — Alchemy on Cloudflare.

## Deployment

Cloudflare via Alchemy (`packages/infra/alchemy.run.ts`) — `bun run deploy` (or
`deploy:dev`). CI (`.github/workflows/ci.yml`) typechecks and tests, prepares
the API, migrates the database, and runs `deploy:dev` on the `development`
branch. Deployed URLs use Cloudflare's `*.workers.dev` domains (no custom
domain).
