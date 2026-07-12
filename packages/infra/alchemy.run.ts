import type { WorkflowMode } from "@video-platform-challenge/types";
import alchemy from "alchemy";
import {
	AccountApiToken,
	AccountId,
	Nextjs,
	R2Bucket,
	Worker,
	Workflow,
} from "alchemy/cloudflare";
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
 * definitions below stay identical across dev/prod.
 */
const STAGES: Record<Stage, { bucketName: string; corsOrigins: string[] }> = {
	dev: {
		bucketName: "video-platform-dev",
		corsOrigins: ["http://localhost:3001", "http://localhost:3000"],
	},
	prod: {
		bucketName: "video-platform-prod",
		corsOrigins: [alchemy.env.CORS_ORIGIN!, alchemy.env.BETTER_AUTH_URL!],
	},
};

const { bucketName, corsOrigins } = STAGES[stage];

const app = await alchemy("video-platform-challenge", { stage });

const accountId = await AccountId();

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

export const bucket = await R2Bucket("video-storage", {
	name: bucketName,
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

export const server = await Worker("server", {
	cwd: "../../apps/server",
	entrypoint: "src/index.ts",
	compatibility: "node",
	url: true,
	bindings: {
		DATABASE_URL: alchemy.secret.env.DATABASE_URL!,
		CORS_ORIGIN: alchemy.env.CORS_ORIGIN!,
		BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
		BETTER_AUTH_URL: alchemy.env.BETTER_AUTH_URL!,
		// Only the server signs URLs, so only the server gets R2 credentials.
		R2_ACCOUNT_ID: accountId,
		R2_BUCKET_NAME: bucket.name,
		R2_ACCESS_KEY_ID: storageToken.accessKeyId,
		R2_SECRET_ACCESS_KEY: storageToken.secretAccessKey,
		// packages/kie's auth header. No KIE_CALLBACK_URL and no callBackUrl is
		KIE_API_KEY: alchemy.secret.env.KIE_API_KEY!,
		KIE_WEBHOOK_SECRET: process.env.KIE_WEBHOOK_SECRET ?? "dev-placeholder",
		AI_GATEWAY_API_KEY: alchemy.secret.env.AI_GATEWAY_API_KEY!,
		VIDEO_GENERATION_WORKFLOW: videoGenerationWorkflow,
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
