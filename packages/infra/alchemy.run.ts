import type { WorkflowMode } from "@video-platform-challenge/types";
import alchemy from "alchemy";
import {
	AccountApiToken,
	AccountId,
	Container,
	computeWorkerDevDomain,
	createCloudflareApi,
	DurableObjectNamespace,
	Nextjs,
	R2Bucket,
	Worker,
	Workflow,
} from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

type Stage = "dev" | "prod";

// alchemy() resolves `stage` from (in order): the explicit option below, then
// `--stage <name>` CLI flag, then `process.env.STAGE`, then finally the OS
// username. We pin it to `STAGE` so the only supported override is the env
// var (see packages/infra/package.json `deploy` script), keeping "dev" as
// the one true local default regardless of who's running it.
const stage: Stage = process.env.STAGE === "prod" ? "prod" : "dev";

/**
 * Everything that differs between stages lives here so the resource
 * definitions below stay identical across dev/prod. CORS/auth origins are
 * NOT stage-keyed — they're local-vs-deploy keyed (see `corsOrigins` below),
 * since a `dev`-stage deploy is just as "real" a Cloudflare deployment as
 * `prod` and must not get localhost CORS.
 */
const STAGES: Record<Stage, { bucketName: string }> = {
	dev: { bucketName: "video-platform-dev" },
	prod: { bucketName: "video-platform-prod" },
};

const { bucketName } = STAGES[stage];

// Alchemy state store. Local dev uses the default file-system store (persistent
// on disk). CI is ephemeral, so alchemy's orphaned-infra guard REFUSES to run
// there with the local store — CI must use a persistent remote store. The
// CloudflareStateStore keeps state in an account-level `alchemy-state-service`
// worker (auth via `ALCHEMY_STATE_TOKEN` + `CLOUDFLARE_API_TOKEN`); `password`
// (`ALCHEMY_PASSWORD`) encrypts the `alchemy.secret()` bindings persisted there.
const app = await alchemy("video-platform-challenge", {
	stage,
	...(process.env.CI
		? {
				password: process.env.ALCHEMY_PASSWORD,
				stateStore: (scope) => new CloudflareStateStore(scope),
			}
		: {}),
});

// `app.local` is true for `alchemy dev` (Miniflare) and false for
// `alchemy deploy` (real Cloudflare resources) — mirrors the `local` flag
// plugsy-ai's packages/infra/alchemy.run.ts derives from `app.local` the
// same way.
const local = app.local;

const accountId = await AccountId();

// This app has no custom domain: on deploy, `server` and `web` both get
// Cloudflare-issued `*.workers.dev` URLs. `server`'s own bindings need BOTH
// `web`'s origin (CORS_ORIGIN / better-auth trustedOrigins) and its OWN url
// (BETTER_AUTH_URL) — neither is knowable yet at the point `server` is
// declared: `web` isn't created until after `server` (it binds
// `server.url`), and a resource can never read its own `.url` while its own
// bindings are still being built. Alchemy derives a Worker's `url: true`
// purely from (account workers.dev subdomain, script name) — see
// `createWorkerUrl` in alchemy/lib/cloudflare/worker-subdomain.ts — with NO
// dependency on the worker having been deployed yet. And absent an explicit
// `name` prop, that script name is exactly `Scope#createPhysicalName(id)`
// lowercased (alchemy/lib/cloudflare/worker.js). Both are public exports, so
// we call them ourselves to resolve both URLs upfront instead of forcing an
// explicit `name` (which would risk renaming/replacing an already-deployed
// Worker) or a circular resource reference.
// TODO: a custom domain would replace this whole precomputation block with
// a single stable, hand-written origin string per app.
const cfApi = local ? null : await createCloudflareApi();
// `computeWorkerDevDomain` returns the BARE workers.dev host (no scheme) —
// alchemy's own website.ts wraps it as `https://${domain}`. These values are
// used as full origins/URLs (R2 CORS origins, CORS_ORIGIN, BETTER_AUTH_URL,
// KIE_CALLBACK_URL base), so prefix the scheme here once.
const serverUrl = cfApi
	? `https://${await computeWorkerDevDomain(
			cfApi,
			app.createPhysicalName("server").toLowerCase(),
		)}`
	: null;
const webUrl = cfApi
	? `https://${await computeWorkerDevDomain(
			cfApi,
			app.createPhysicalName("web").toLowerCase(),
		)}`
	: null;

// R2's CORS check is a literal Origin match (S3-compatible), same as the
// Hono `cors()` origin check server-side (a plain string, not a pattern) —
// so local dev keeps today's localhost pair unchanged, and deploys (no
// custom domain) allow the two workers.dev origins resolved above.
const corsOrigins = local
	? ["http://localhost:3001", "http://localhost:3000"]
	: [webUrl!, serverUrl!];

// Trigger payload for a video generation run. Mirrors (by hand — infra and
// the Worker script are separate TS programs, so this can't `import type`
// from apps/server) the `VideoGenerationWorkflowParams` type declared next
// to the WorkflowEntrypoint class in
// apps/server/src/workflows/video-generation.ts. Keep the two in sync.
type VideoGenerationWorkflowParams = {
	projectId: string;
	// Threaded through explicitly rather than looked up inside the workflow:
	// the workflow has no session, and every DB access goes through
	// withUser(db, userId, ...) — see phase 3b-2 deviations note.
	userId: string;
	// Fix-pass W9b: sourced from packages/types (dependency-free, safe for
	// infra to depend on) instead of a hand-mirrored string union — the
	// `sceneId?` field below still can't be, since `VideoGenerationWorkflowParams`
	// itself lives in apps/server (not a shared package), so this type as a
	// whole stays hand-mirrored; only `mode`'s own type is now shared.
	mode: WorkflowMode;
	// Required for scene-retry; absent for project-generation/scene-extension
	// (the plan step creates all scenes for project-generation; scene-extension
	// uses the batch field below instead).
	sceneId?: string;
	// Required for scene-extension (docs scenes-architecture-v3.md A4): the
	// batch of placeholder scene ids processed sequentially in one workflow
	// instance. Kept alongside `sceneId` for back-compat — see that field's
	// own doc comment in apps/server/src/workflows/video-generation.ts.
	sceneIds?: string[];
};

// Orchestrates one project's generation run (plan → character/location
// sheets → keyframes → scene videos → assembly, per
// docs/video-engine-architecture.md §4). No Queue: the doc's own analysis
// rejects Queues for this (no ordering guarantee, no wait-for-event, 128KB
// messages — they'd force hand-rolling a state machine Workflows already
// gives us). The kie.ai webhook route (apps/server, phase 3b) fans in
// directly via `instance.sendEvent(...)` after verifying the HMAC — no
// intermediate queue needed for that hop either. Revisit only if a concrete
// need shows up (e.g. batching webhook bursts), not preemptively.
export const videoGenerationWorkflow = Workflow<VideoGenerationWorkflowParams>(
	"video-generation-workflow",
	{
		workflowName: `video-platform-${stage}-video-generation`,
		className: "VideoGenerationWorkflow",
	},
);

// Per-project SSE fan-out relay (RT-3, docs
// realtime-and-render-lock-v1.md §1): one Durable Object instance per
// project holds that project's connected EventSource clients and pushes
// each already-persisted status transition to them — Postgres stays the
// source of truth (the DO is a fan-out relay only, no authoritative state).
// Mirrors `videoGenerationWorkflow` above: the concrete `ProjectEventsDO`
// class lives in apps/server (src/durable/project-events.ts) and is
// re-exported from src/index.ts so alchemy can resolve it by `className`
// off the compiled worker script, same mechanism as
// `VideoGenerationWorkflow`. Left untyped (no generic type param, unlike
// `Workflow<VideoGenerationWorkflowParams>` above) for the same reason that
// type is hand-mirrored instead of imported: infra and the Worker script
// are separate TS programs, so this file can't `import type` the real class
// from apps/server. apps/server narrows `env.PROJECT_EVENTS` to the real
// class's RPC shape locally instead (see lib/notify-project-event.ts's doc
// comment).
export const projectEventsNamespace = DurableObjectNamespace("project-events", {
	className: "ProjectEventsDO",
	// Cloudflare no longer allows KV-backed DO namespaces on new accounts —
	// they must be SQLite-backed (`new_sqlite_classes`). ProjectEventsDO holds
	// no persisted state (in-memory SSE writer set), so SQLite storage is unused
	// but required by the platform.
	sqlite: true,
});

// Shared ffmpeg media-ops Container (docs/media-ops-container.md §3): a
// scale-to-zero box that runs ffmpeg for last-frame extraction and audio
// extraction. alchemy builds containers/media-ops/Dockerfile and pushes it to
// the CF container registry on deploy. The concrete `MediaOpsContainer` class
// lives in apps/server (src/durable/media-ops-container.ts) and is re-exported
// from src/index.ts so alchemy resolves it by `className` off the compiled
// worker script — same mechanism as `videoGenerationWorkflow` /
// `projectEventsNamespace` above, and untyped for the same reason (infra and
// the Worker script are separate TS programs, so this file can't `import type`
// the real class; apps/server narrows `env.MEDIA_OPS` to the real class's shape
// locally — see lib/media-ops.ts's doc comment).
// `dev.remote: false` → local build via the Docker daemon (Docker Desktop must
// be running); remote build + push happens on deploy.
//
// `build.context` is the MONOREPO ROOT (`../..` from this file's cwd,
// packages/infra), not just containers/media-ops: that dir is now a bun
// workspace member whose deps (fastify, tsx, zod) are pinned through the
// root package.json's `catalog:` protocol, so building its Dockerfile needs
// the root package.json + lockfile + every workspace's package.json in the
// build context to resolve them (see the Dockerfile's own header comment +
// containers/media-ops/Dockerfile.dockerignore for what stays out of that
// context).
//
// MEDIA_OPS_SECRET coordination note: alchemy@0.93.12's `Container()` resource
// (`ContainerProps` in node_modules/alchemy/lib/cloudflare/container.d.ts) has
// NO `environment_variables` / `secrets` prop — those only exist on the
// lower-level `ContainerApplicationProps`/`DeploymentConfiguration` used by
// the separate `ContainerApplication` resource, not on this `Container()`
// binding helper. So this file cannot inject MEDIA_OPS_SECRET into the
// container's process env directly. It IS bound onto the `server` Worker
// below (`MEDIA_OPS_SECRET: alchemy.secret.env.MEDIA_OPS_SECRET!`), and
// Durable Objects receive that same Worker env in their constructor, so
// `MediaOpsContainer` (apps/server/src/durable/media-ops-container.ts)
// forwards it itself via its constructor: `this.envVars = { MEDIA_OPS_SECRET:
// env.MEDIA_OPS_SECRET }` — `envVars` is a public property on
// `@cloudflare/containers`' `Container` base class (see
// node_modules/@cloudflare/containers/dist/lib/container.d.ts).
export const mediaOps = await Container("media-ops", {
	className: "MediaOpsContainer",
	build: { context: "../..", dockerfile: "containers/media-ops/Dockerfile" },
	instanceType: "basic",
	maxInstances: 5,
	dev: { remote: false },
});

export const bucket = await R2Bucket("video-storage", {
	name: bucketName,
	// Adopt the bucket if it already exists (a prior local dev run creates it —
	// `dev.remote: true` writes to the REAL bucket). Without this, the first CI
	// deploy against a fresh state store tries to CREATE it and 409s.
	adopt: true,
	devDomain: false,
	dev: { remote: true },
	cors: [
		{
			allowed: {
				methods: ["GET", "PUT", "POST", "HEAD"],
				origins: corsOrigins,
				headers: ["content-type", "range", "if-match"],
			},
			exposeHeaders: ["etag", "content-range", "content-length"],
			maxAgeSeconds: 3600,
		},
	],
});

const storageToken = await AccountApiToken("video-storage-token", {
	name: `video-platform-${stage}-storage-token`,
	policies: [
		{
			effect: "allow",
			permissionGroups: [
				"Workers R2 Storage Bucket Item Read",
				"Workers R2 Storage Bucket Item Write",
			],
			resources: {
				[`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket.name}`]:
					"*",
			},
		},
	],
});

// NOTE: the DB stays on the `@neondatabase/serverless` driver for now (works in
// both miniflare-local and the deployed Worker over its WS/HTTP transport). A
// Cloudflare Hyperdrive migration (postgres.js over an edge-pooled binding) is
// deferred — the local `alchemy dev` Hyperdrive proxy connected to Neon without
// TLS ("connection is insecure"), so it's a future hardening step (owner call).
export const server = await Worker("server", {
	cwd: "../../apps/server",
	entrypoint: "src/index.ts",
	compatibility: "node",
	url: true,
	bindings: {
		DATABASE_URL: alchemy.secret.env.DATABASE_URL!,
		// Local dev: unchanged, read from .env (see STAGES doc comment above).
		// Deploy: no custom domain, so these are the precomputed workers.dev
		// origins resolved above — `webUrl` for CORS_ORIGIN (also better-auth's
		// trustedOrigins, packages/auth reuses this same var) and this Worker's
		// own `serverUrl` for BETTER_AUTH_URL (better-auth's baseURL).
		CORS_ORIGIN: local ? alchemy.env.CORS_ORIGIN! : webUrl!,
		BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
		BETTER_AUTH_URL: local ? alchemy.env.BETTER_AUTH_URL! : serverUrl!,
		// Only the server signs URLs, so only the server gets R2 credentials.
		R2_ACCOUNT_ID: accountId,
		R2_BUCKET_NAME: bucket.name,
		R2_ACCESS_KEY_ID: storageToken.accessKeyId,
		R2_SECRET_ACCESS_KEY: storageToken.secretAccessKey,
		// packages/kie's auth header.
		KIE_API_KEY: alchemy.secret.env.KIE_API_KEY!,
		// kie.ai posts task-completion callbacks here on deploy. Only a PUBLIC
		// origin is reachable, so localhost gets "" and `resolveKieCallbackUrl`
		// falls back to polling (the workflow's poll loop is the source of truth
		// either way — the callback is an additive trigger). Path mirrors
		// packages/kie's `KIE_WEBHOOK_PATH`, inlined because this file runs under
		// node and can't import packages/kie (it pulls in `cloudflare:workers`).
		KIE_CALLBACK_URL: local ? "" : `${serverUrl}/webhooks/kie`,
		KIE_WEBHOOK_SECRET: process.env.KIE_WEBHOOK_SECRET ?? "dev-placeholder",
		AI_GATEWAY_API_KEY: alchemy.secret.env.AI_GATEWAY_API_KEY!,
		VIDEO_GENERATION_WORKFLOW: videoGenerationWorkflow,
		PROJECT_EVENTS: projectEventsNamespace,
		MEDIA_OPS: mediaOps,
		// Shared secret the MediaOpsContainer validates on every request
		// (`authorization: Bearer <secret>`) and lib/media-ops.ts sends — see the
		// `mediaOps` Container declaration above for how (and why not directly
		// via alchemy) the container process itself gets this same value.
		MEDIA_OPS_SECRET: alchemy.secret.env.MEDIA_OPS_SECRET!,
		// Native R2 Workers binding for the same bucket the server already signs
		// URLs into (owner call). Exposes `env.VIDEO_STORAGE` as an R2Bucket so the
		// Worker can do native `list()` / `delete(keys)` — used later for R2
		// cleanup (docs Feature 3). Declared now so it flows into `server.Env`; no
		// consumer yet. This is orthogonal to the aws4fetch signed-URL path in
		// packages/storage (which stays for cross-service signed GET/PUT).
		VIDEO_STORAGE: bucket,
	},
	dev: { port: 3000 },
});

export const web = await Nextjs("web", {
	cwd: "../../apps/web",
	bindings: {
		NEXT_PUBLIC_SERVER_URL: server.url!,
	},
	dev: { env: { PORT: "3001" } },
});

console.log(`Stage  -> ${stage}`);
console.log(`Web    -> ${web.url}`);
console.log(`Server -> ${server.url}`);

await app.finalize();
