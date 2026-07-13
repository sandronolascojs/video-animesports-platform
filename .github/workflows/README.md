# GitHub Actions

## CI/CD

**Workflow:** `ci.yml`
**Triggers:** pull requests into `development`, and pushes to `development` (this repo's base branch — there is no `main`).

```
checks (Lint · Typecheck · Test · Build, matrix, parallel)
   └─▶ [push to development only, gated on checks passing] ─▶ deploy (dev)
                                                                  ├─ Drizzle migrate (Postgres)
                                                                  └─ alchemy deploy --stage dev
```

- **PRs** run `checks` only — required for merge (enable it as a required status check under **Settings → Branches**).
- **Pushes to `development`** run the same `checks`, then `deploy`. `deploy` runs Drizzle migrations against the dev Postgres database, then `alchemy deploy` for the `dev` stage. Deploy runs on `ubuntu-latest` (Docker preinstalled — `alchemy deploy` builds the `media-ops` Cloudflare Container image from `containers/media-ops/Dockerfile`).
- This app has only one alchemy stage wired to CI: `dev` (see `packages/infra/alchemy.run.ts`, `Stage = "dev" | "prod"`). There is no `production` environment/job here.

### Dropped from the plugsy-ai template this was adapted from

- **Stripe** — this app has no billing; no Stripe env/steps.
- **AI evals** (`ai-evals*.yml`) — not copied. `packages/ai/evals` is a dev-only harness, not a CI gate.
- **Self-hosted runners, `changes` paths-filter, dependency-audit job, Neon db-tests job, Playwright e2e job, `production` stage** — all dropped for a lean pipeline; this repo doesn't have that infra (self-hosted runners) or that surface (no e2e suite, single deploy stage).

### Required secrets — GitHub Environment `development`

All of these are consumed by the `deploy` job (Drizzle migrate + `alchemy deploy --stage dev`). Configure them under **Settings → Environments → development**.

| Secret | Used for |
| --- | --- |
| `DATABASE_URL` | Postgres connection string — Drizzle migration, and the server Worker's `DATABASE_URL` binding. |
| `BETTER_AUTH_SECRET` | better-auth session secret — server Worker binding. |
| `BETTER_AUTH_URL` | better-auth base URL — server Worker binding. |
| `CORS_ORIGIN` | Allowed CORS origin for the server Worker. |
| `KIE_API_KEY` | kie.ai provider API key (`packages/kie`) — server Worker binding. |
| `KIE_WEBHOOK_SECRET` | kie.ai webhook signature secret — server Worker binding (falls back to a `dev-placeholder` if unset, but should be set for a real dev deploy). |
| `AI_GATEWAY_API_KEY` | AI Gateway key (`packages/ai`) — server Worker binding. |
| `CLOUDFLARE_API_TOKEN` | Authenticates alchemy's Cloudflare provider (Workers, R2, Containers, Nextjs). |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id — alchemy provider + `AccountId()`/`AccountApiToken()` calls in `alchemy.run.ts`. |

Not needed as CI secrets: `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` — these are derived at deploy time by `alchemy.run.ts` itself (`AccountId()`, `bucket.name`, `storageToken.accessKeyId/secretAccessKey`), not sourced from the environment.

There is no custom domain for this app — deploy uses the Cloudflare-provided `workers.dev` URLs, nothing to configure domain-wise in CI.

### Root scripts added for this workflow

- `deploy:dev` — local convenience: `bun run --filter @video-platform-challenge/infra deploy:dev` (loads `packages/infra/.env`).
- `db:migrate` — already existed (`turbo run db:migrate -F @video-platform-challenge/db` → `drizzle-kit migrate`); the `deploy` job reuses it as-is.

`packages/infra/package.json` also gained `deploy:dev` (local, `--env-file .env`) and `deploy:dev:ci` (no env-file — CI supplies env vars directly via the `development` environment secrets). The `alchemy` CLI binary only resolves from `packages/infra/node_modules/.bin` in this repo's Bun install layout (not hoisted to the workspace root), so both the root `deploy:dev` script and the CI `deploy` job invoke it through `bun run --filter @video-platform-challenge/infra <script>` rather than calling `alchemy` bare from the repo root.
