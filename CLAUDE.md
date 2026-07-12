# Architecture Rules — video-platform-challenge

Bun workspaces + Turborepo. Workspace scope: `@video-platform-challenge/*`.

## Package boundaries

| Package | Role | Workspace deps allowed |
| --- | --- | --- |
| `packages/types` | Shared enums + constants + the pagination contract (zod) | none (zod only) |
| `packages/api` | THE contract between web and server: zod schemas + oRPC contract (`oc` from `@orpc/contract`) | `types` |
| `packages/db` | Drizzle schema + ready-to-use `db` instance | `types`, `env` |
| `packages/auth` | better-auth setup | `db`, `env` |
| `packages/storage` | R2 signed-URL storage library | `env` |
| `packages/kie` | kie.ai provider adapter (createTask/recordInfo, model wrappers, webhook verify) — zero business logic | `types`, `env` |
| `packages/ai` | AI foundations: agent definitions, prompt registry, model runtime, caches — AI SDK only, no transport/db | `types`, `env` |
| `apps/server` | Implements the contract: procedures, middlewares, context, routers, services, repositories | `api`, `auth`, `db`, `env`, `kie` |
| `apps/web` | Next.js frontend | `api`, `env` |

`packages/api` must NEVER import env/config/db/auth or `@orpc/server`. Pure declarations only — both sides depend on it; it depends on nothing runtime.

`packages/kie` mirrors `packages/storage`'s edge-library style (plain functions, env-only config) but also depends on `packages/types` — it needs `AspectRatio`/`AudioLanguage` for its typed model wrappers, and `types` is a zero-dependency leaf package every layer may depend on (same precedent as `packages/db`). Only `apps/server` may import `packages/kie` (parallel to the storage rule below).

`packages/ai` mirrors `packages/kie`'s style (plain functions/exports, env-only config) and depends on `types` + `env` — agent definitions, prompt registry, model runtime, and caches, AI SDK only, no transport/db. It must NEVER import `packages/api` (schemas stay the contract; agents accept them as arguments instead) (dev-only exception: evals under `packages/ai/evals/` may import `packages/api` schemas as fixtures — production code under `src/` still can't). Only `apps/server` may import `packages/ai` (same rule as kie/storage).

## Backend (apps/server): router → service → repository

- `lib/orpc.ts`: `implement(appContract)` + middlewares (`publicProcedure`, `protectedProcedure`).
- `lib/context.ts`: request context is `{ session }` only. No db on the context.
- `routers/`: wire contract procedures to services. No business logic here.
- `services/`: business logic. Call repositories, never the db directly.
- `repositories/`: the ONLY place database queries live. Import the db directly: `import { db } from "@video-platform-challenge/db"`.
- Signed upload/download URLs come from `@video-platform-challenge/storage`; only `apps/server` may use it.

## Database (packages/db)

- One file per table under `src/schema/`. `schema/index.ts` exports enums FIRST, then tables, so drizzle-kit generates enum DDL before table DDL.
- `src/shared/enums.ts`: pgEnums built from `packages/types` values — `pgEnum("video_status", [VideoStatus.PROCESSING, ...])`. Never hardcode enum strings in the schema.
- `src/shared/id.ts`: every primary key uses the `id(name)` helper — text PK, not null, cuid2 default (`@paralleldrive/cuid2`). Examples: `id()`, `id("user_id")`, `id("video_id")`.

## Shared types (packages/types)

- All enums and constants shared between frontend, backend, and db live here. Never redeclare them in an app.
- Enum pattern (no TS `enum`):

  ```ts
  export const VideoStatus = { PROCESSING: "processing", READY: "ready", FAILED: "failed" } as const;
  export type VideoStatus = (typeof VideoStatus)[keyof typeof VideoStatus];
  ```

## Frontend (apps/web/src)

- `app/`: ONLY pages, layouts, and SSR calls. Route groups: `(auth)` for auth pages, `(private)` for authenticated pages. `/` is the dashboard.
- `feature/{featurename}/views|hooks|components|stores`: feature code. ALL query/mutation hooks live in `feature/{featurename}/hooks/http/` — thin hooks wrapping oRPC + tanstack-query (e.g. `useProject()`). Pages SSR-prefetch via the server oRPC client + `HydrationBoundary` so hooks hydrate without a client refetch.
- `components/`: shared cross-feature components. `components/ui/`: shadcn primitives.
- `libs/{libname}/`: app-wide clients and utilities (`orpc`, `auth`, `utils`).
- Form validation uses the shared zod schemas from `@video-platform-challenge/api` — never inline duplicates.

## Conventions

- Named exports, plain functions, no classes.
- Biome: tabs, double quotes. `bun run check-types` must stay green.
- Shared version pins go in the root `package.json` Bun `catalog:`; internal deps use `workspace:*`.
