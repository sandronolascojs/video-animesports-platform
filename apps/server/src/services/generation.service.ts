// Generation pipeline — the real implementation behind the phase-3b-1
// stubs (docs §4, §9, phase 3b-2). Owns every DB/kie/R2 side effect the
// VideoGenerationWorkflow's steps need; the workflow file owns only
// orchestration (step sequencing, retries, wait/poll) — see
// workflows/video-generation.ts.
import {
	transcribeSpeech,
	translateSubtitleCues,
	translateSubtitleText,
} from "@video-platform-challenge/ai";
import * as promptBuilders from "@video-platform-challenge/ai/prompts/prompt-builders";
import { compileStyleBible } from "@video-platform-challenge/ai/prompts/style-bible";
import type { UserScopedTx } from "@video-platform-challenge/db";
import { db, withUser } from "@video-platform-challenge/db";
import { env } from "@video-platform-challenge/env/server";
import {
	createTokenBucket,
	generateImage,
	generateVideo,
	isAllowedResultUrl,
	KIE_RATE_LIMIT,
	MAX_IMAGE_INPUT_URLS,
} from "@video-platform-challenge/kie";
import {
	createSignedDownloadUrl,
	putObject,
} from "@video-platform-challenge/storage";
import type {
	AspectRatio,
	ProjectPlan,
	ProjectPlanCharacter,
	ProjectPlanCinematography,
	ProjectPlanKeyframe,
	ProjectPlanLocation,
	SpeechCue,
	SubtitleLanguage,
	TimelineEntry,
} from "@video-platform-challenge/types";
import {
	AssetKind,
	AssetStatus,
	GenerationTaskKind,
	GenerationTaskStatus,
	ProjectStatus,
	SceneStatus,
	WorkflowMode,
} from "@video-platform-challenge/types";

import {
	mergeExtensionCharacters,
	mergeExtensionLocation,
} from "../lib/extension-plan-merge";
import { formatFailReason } from "../lib/fail-reason";
import { classifyIngestFailure } from "../lib/ingest-failure";
import { resolveKieCallbackUrl } from "../lib/kie-callback";
import { extractLastFrame } from "../lib/media-ops";
import { notifyProjectEvent } from "../lib/notify-project-event";
import { normalizeProjectPlan } from "../lib/plan-compat";
import { buildAssetR2Key, DEFAULT_CONTENT_TYPE_BY_KIND } from "../lib/r2-keys";
import type { AssetRow } from "../repositories/asset.repository";
import * as assetRepository from "../repositories/asset.repository";
import type { GenerationTaskRow } from "../repositories/generation-task.repository";
import * as generationTaskRepository from "../repositories/generation-task.repository";
import type { ProjectRow } from "../repositories/project.repository";
import * as projectRepository from "../repositories/project.repository";
import type { SceneRow } from "../repositories/scene.repository";
import * as sceneRepository from "../repositories/scene.repository";
import type { VideoGenerationWorkflowParams } from "../workflows/video-generation";
import * as planService from "./plan.service";

// kie.ai: 20 createTask/10s account-wide (docs §3). This bucket is
// isolate-local (packages/kie's own doc comment) — real pacing comes from
// the workflow's sequential step order; this is defense in depth against
// bursts within one step (docs phase 3b-2 edge case 7).
const kieRateLimiter = createTokenBucket(KIE_RATE_LIMIT);

async function paced<T>(fn: () => Promise<T>): Promise<T> {
	await kieRateLimiter.take();
	return fn();
}

// `callBackUrl` is now env-gated (lib/kie-callback.ts's
// `resolveKieCallbackUrl`): every kie.ai createTask call below passes it, but
// it only resolves to a real URL when `BETTER_AUTH_URL` is a public http(s)
// origin (never localhost) — deployed, kie.ai's callback hits
// `/webhooks/kie` (generation-webhook.service.ts) and nudges the owning
// workflow instance via `sendEvent`. On local dev it resolves to `undefined`
// and createTask omits `callBackUrl` entirely — identical to the old
// no-callback behavior. Either way, completion is still discovered
// exclusively by polling — workflows/video-generation.ts's `waitForKieTask`
// never waits on the callback event; see that file's `// TODO` on full
// event-driven waiting. The callback is additive only, never a replacement.
async function startWorkflow(
	params: VideoGenerationWorkflowParams,
): Promise<string> {
	const instance = await env.VIDEO_GENERATION_WORKFLOW.create({ params });
	return instance.id;
}

// ---------------------------------------------------------------------------
// Kickoff — replaces the phase-3b-1 no-op stubs. Each call site already has
// `userId` in scope (session.user.id) — threaded through explicitly rather
// than looked up inside the workflow, since the workflow has no session and
// every DB access must go through withUser(db, userId, ...) (docs phase
// 3b-2 deviations note: this changes the stubs' original 1-2 arg
// signatures, callers updated accordingly).
//
// If starting the workflow itself throws (e.g. a misconfigured binding, or
// — for the smoke test — placeholder KIE_*/AI_GATEWAY_API_KEY credentials
// surfacing at first use inside the workflow rather than at instance
// creation), the owning row is marked failed instead of left hanging
// forever in a pending status. This IS the required error-first smoke path
// when real provider credentials aren't available (docs phase 3b-2 VERIFY).
// ---------------------------------------------------------------------------

export async function startProjectGeneration(
	projectId: string,
	userId: string,
): Promise<void> {
	try {
		await startWorkflow({
			projectId,
			userId,
			mode: WorkflowMode.PROJECT_GENERATION,
		});
	} catch (error) {
		console.error(
			`[generation.service] failed to start project-generation workflow (project=${projectId})`,
			error,
		);
		await withUser(db, userId, (tx) =>
			projectRepository.updateById(tx, userId, projectId, {
				status: ProjectStatus.FAILED,
				failReason:
					"Failed to start the generation workflow. Please try again.",
			}),
		);
	}
}

/**
 * Kicks ONE workflow instance for the whole extension batch (docs
 * scenes-architecture-v3.md A4 "one workflow per batch fixes a real race") —
 * `sceneIds` are the N placeholder rows `project.service.ts::extend` already
 * inserted, in batch order; the workflow's `SCENE_EXTENSION` branch processes
 * them sequentially, each chaining from the keyframe state the previous one
 * left.
 */
export async function startSceneExtension(
	projectId: string,
	sceneIds: string[],
	userId: string,
): Promise<void> {
	try {
		await startWorkflow({
			projectId,
			userId,
			mode: WorkflowMode.SCENE_EXTENSION,
			sceneIds,
		});
	} catch (error) {
		console.error(
			`[generation.service] failed to start scene-extension workflow (scenes=${sceneIds.join(",")})`,
			error,
		);
		await withUser(db, userId, async (tx) => {
			for (const sceneId of sceneIds) {
				await sceneRepository.updateById(tx, userId, sceneId, {
					status: SceneStatus.FAILED,
					failReason:
						"Failed to start the extension workflow. Please try again.",
				});
			}
		});
		// Fix-pass B1: project.service.ts::extend flips the project to
		// `generating` INSIDE the same tx as the status guard, before this
		// kickoff runs. If the workflow never actually starts, nothing else
		// will ever call finalizeProject for this run — without this, the
		// project would be stuck in `generating` forever (and the
		// one-active-workflow-per-project guard would permanently block
		// every future extend/retry). Reuses the same status-resolution
		// logic the workflow's own finalize step uses.
		await finalizeProject(userId, projectId);
	}
}

export async function retryScene(
	sceneId: string,
	userId: string,
): Promise<void> {
	const scene = await withUser(db, userId, (tx) =>
		sceneRepository.findById(tx, userId, sceneId),
	);
	if (!scene) {
		// Deleted between the caller's commit and this call — nothing to kick.
		return;
	}

	try {
		await startWorkflow({
			projectId: scene.projectId,
			userId,
			mode: WorkflowMode.SCENE_RETRY,
			sceneId,
		});
	} catch (error) {
		console.error(
			`[generation.service] failed to start scene-retry workflow (scene=${sceneId})`,
			error,
		);
		await withUser(db, userId, (tx) =>
			sceneRepository.updateById(tx, userId, sceneId, {
				status: SceneStatus.FAILED,
				failReason: "Failed to restart generation. Please try again.",
			}),
		);
		// BLOCKER fix (GEN-6b): scene.service.ts::retry now flips the project
		// to `generating` INSIDE the same tx as its terminal-status guard,
		// BEFORE this kickoff runs (mirroring project.service.ts::extend's
		// one-active-workflow-per-project guard). If the workflow never
		// actually starts, nothing else will ever call finalizeProject for
		// this run — without this, the project would be stuck in
		// `generating` forever, exactly like startSceneExtension's own catch
		// branch above.
		await finalizeProject(userId, scene.projectId);
	}
}

/**
 * Deliberately a no-op (docs phase 3b-2 design anchor 6). R1 assembly is
 * entirely browser-driven (Mediabunny remux): version.service.ts already
 * persisted the version row as `rendering` before calling this. The browser
 * fetches clip URLs via `assets.getProjectUrls`, uploads the finished MP4
 * via the new `assets.createUpload`, then calls `versions.markRendered` to
 * complete the flow — no server-side workflow is involved for R1. The
 * canonical ffmpeg/Containers renderer (R2 milestone, docs §5) is future
 * work; this function stays exported (same signature, now with `userId`) so
 * the call site doesn't have to change again when that lands.
 */
export async function startRender(
	_versionId: string,
	_userId: string,
): Promise<void> {}

// ---------------------------------------------------------------------------
// Context loaders — thin withUser wrappers the workflow uses to read state
// between steps (a Workflow instance has no memory between step.do calls
// beyond what each step returns, so re-reading is normal here).
// ---------------------------------------------------------------------------

export async function loadProject(
	userId: string,
	projectId: string,
): Promise<ProjectRow | null> {
	return withUser(db, userId, (tx) =>
		projectRepository.findById(tx, userId, projectId),
	);
}

export async function loadScenes(
	userId: string,
	projectId: string,
): Promise<SceneRow[]> {
	return withUser(db, userId, (tx) =>
		sceneRepository.findManyByProjectId(tx, userId, projectId),
	);
}

export async function loadScene(
	userId: string,
	sceneId: string,
): Promise<SceneRow | null> {
	return withUser(db, userId, (tx) =>
		sceneRepository.findById(tx, userId, sceneId),
	);
}

/** Signed GET URL for an asset by id — used to hand kie.ai a fetchable
 * `first_frame_url`/`last_frame_url` for our own R2 objects. */
export async function resolveAssetDownloadUrl(
	userId: string,
	assetId: string,
): Promise<string | null> {
	const asset = await withUser(db, userId, (tx) =>
		assetRepository.findById(tx, userId, assetId),
	);
	if (!asset?.r2Key) {
		return null;
	}
	const signed = await createSignedDownloadUrl({ key: asset.r2Key });
	return signed.url;
}

// ---------------------------------------------------------------------------
// Plan step
// ---------------------------------------------------------------------------

export interface PlanStepResult {
	project: ProjectRow;
	scenes: SceneRow[];
}

/**
 * Runs the initial StoryPlan and zips it onto the project's existing
 * INITIAL_SCENE_COUNT placeholder scene rows (created synchronously by
 * project.service.ts::create) — matched by `projects.draft_timeline` order,
 * the ONLY ordering authority (docs §6), not insertion order (a batch
 * insert gives every row the identical `defaultNow()` timestamp).
 * Returns `null` if the project was deleted mid-flight (docs edge case
 * list) — the workflow exits quietly in that case.
 */
export async function runPlanStep(
	userId: string,
	projectId: string,
): Promise<PlanStepResult | null> {
	const result = await withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, projectId);
		if (!project) {
			return null;
		}

		const existingScenes = await sceneRepository.findManyByProjectId(
			tx,
			userId,
			projectId,
		);
		const sceneById = new Map(existingScenes.map((scene) => [scene.id, scene]));
		const orderedScenes = project.draftTimeline
			.map((entry) => sceneById.get(entry.sceneId))
			.filter((scene): scene is SceneRow => scene !== undefined);

		const plan = await planService.generateStoryPlan({
			description: project.description,
			templateKey: project.templateKey,
			sceneCount: orderedScenes.length,
			audioLanguage: project.audioLanguage,
			subtitleLanguage: project.subtitleLanguage,
		});

		const projectPlan: ProjectPlan = {
			styleBibleSpec: plan.styleBibleSpec,
			characters: plan.characters.map((character) => ({
				name: character.name,
				role: character.role,
				visualDescription: character.visualDescription,
				gender: character.gender,
				sheetAssetId: null,
			})),
			locations: plan.locations.map((location) => ({
				key: location.key,
				name: location.name,
				description: location.description,
				timeOfDay: location.timeOfDay,
				sheetAssetId: null,
			})),
			scenes: [],
			// Same array, field-for-field compatible (packages/api's
			// storyPlanKeyframeSchema mirrors packages/types' ProjectPlanKeyframe
			// exactly) — no mapping needed.
			keyframes: plan.keyframes,
		};

		const updatedScenes: SceneRow[] = [];
		const timeline: TimelineEntry[] = [...project.draftTimeline];
		for (let index = 0; index < orderedScenes.length; index++) {
			const sceneRow = orderedScenes[index];
			const planScene = plan.scenes[index];
			if (!sceneRow || !planScene) {
				continue;
			}

			const updated = await sceneRepository.updateById(
				tx,
				userId,
				sceneRow.id,
				{
					title: planScene.title,
					prompt: planScene.prompt,
					dialogue: planScene.dialogue,
					speakerName: planScene.speaker,
					subtitleText: planScene.subtitleText,
					durationSeconds: planScene.durationSeconds,
					status: SceneStatus.KEYFRAME_PENDING,
				},
			);
			if (!updated) {
				continue;
			}

			updatedScenes.push(updated);
			projectPlan.scenes.push({
				sceneId: updated.id,
				characterNames: planScene.characterNames,
				locationKey: planScene.locationKey,
				cinematography: planScene.cinematography,
			});

			const timelineIndex = timeline.findIndex(
				(entry) => entry.sceneId === updated.id,
			);
			const existingEntry =
				timelineIndex >= 0 ? timeline[timelineIndex] : undefined;
			if (existingEntry) {
				timeline[timelineIndex] = {
					...existingEntry,
					durationSeconds: updated.durationSeconds,
				};
			}
		}

		const updatedProject = await projectRepository.updateById(
			tx,
			userId,
			projectId,
			{
				title: plan.title,
				synopsis: plan.synopsis,
				// The ONE deterministic compiler (architecture/v2-prompt-craft):
				// compiles the LLM's structured StyleBibleSpec into the canonical
				// text block prepended to every downstream image/video prompt.
				// `projects.styleBible` stays a plain string column (docs §6,
				// Workflows Rpc.Serializable constraint) — the structured spec
				// itself lives in `projectPlan.styleBibleSpec` above.
				styleBible: compileStyleBible(plan.styleBibleSpec),
				plan: projectPlan,
				// Fix-pass W5: `storyboard` (not `generating`) — the plan is
				// persisted and visible, but no kie.ai task exists yet. The
				// workflow (runProjectGenerationMode) flips this to `generating`
				// itself right before it starts creating sheet/keyframe tasks.
				status: ProjectStatus.STORYBOARD,
				draftTimeline: timeline,
			},
		);
		if (!updatedProject) {
			return null;
		}

		return { project: updatedProject, scenes: updatedScenes };
	});

	// RT-3 (docs realtime-and-render-lock-v1.md §1 piece 4): broadcast AFTER
	// the transaction has committed, never from inside it — a Postgres
	// transaction should never sit open across the DO's network round trip
	// (mirrors fetchAndPutToR2's own "outside any DB transaction" doc
	// comment). One `scene` event per scene the plan step just flipped to
	// `keyframe_pending`.
	if (result) {
		for (const scene of result.scenes) {
			await notifyProjectEvent(env, {
				type: "scene",
				projectId,
				sceneId: scene.id,
				status: SceneStatus.KEYFRAME_PENDING,
				at: Date.now(),
			});
		}
	}

	return result;
}

export interface ExtensionPlanStepResult {
	project: ProjectRow;
	scene: SceneRow;
}

/**
 * Runs the extendStory step for one already-inserted placeholder scene
 * (project.service.ts::extend already appended it to draft_timeline before
 * calling startSceneExtension). Reuses existing characters/locations from
 * `projects.plan` where possible; defensively creates a plan entry for any
 * new name/key the agent introduces anyway, so a later sheet-generation
 * pass always has something to work from.
 */
export async function runExtensionPlanStep(
	userId: string,
	projectId: string,
	sceneId: string,
	prompt?: string,
): Promise<ExtensionPlanStepResult | null> {
	const result = await withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, projectId);
		if (!project?.plan) {
			return null;
		}
		const scene = await sceneRepository.findById(tx, userId, sceneId);
		if (!scene) {
			return null;
		}

		const allScenes = await sceneRepository.findManyByProjectId(
			tx,
			userId,
			projectId,
		);
		const sceneById = new Map(allScenes.map((row) => [row.id, row]));
		// Prior scenes only (excludes the new placeholder `sceneId` itself) —
		// both the storySoFar context AND the compat normalization below need
		// exactly the scene set the STORY-SO-FAR keyframe chain was built over.
		const priorScenes = project.draftTimeline
			.map((entry) => sceneById.get(entry.sceneId))
			.filter(
				(row): row is SceneRow => row !== undefined && row.id !== sceneId,
			);
		const storySoFar = priorScenes.map((row) => ({
			title: row.title ?? "",
			prompt: row.prompt,
			dialogue: row.dialogue ?? "",
		}));

		const styleBible =
			typeof project.styleBible === "string"
				? project.styleBible
				: JSON.stringify(project.styleBible ?? "");

		// Compat (architecture/v2-prompt-craft): heals a plan predating the
		// structured StyleBibleSpec/keyframe-chain/cinematography upgrade — see
		// lib/plan-compat.ts's doc comment. From this point on, `normalizedPlan`
		// (and everything derived from it below) is ALWAYS fully structured;
		// the healed shape is what gets persisted, so future reads of this
		// project (retries, further extensions) never need the fallback again.
		const normalizedPlan = normalizeProjectPlan(
			project.plan,
			priorScenes.map((row) => ({ id: row.id, prompt: row.prompt })),
		);
		const previousKeyframeDescription =
			normalizedPlan.keyframes.at(-1)?.description ?? "";
		// docs §8d MEDIUM: "extend agent context too thin" — ground the
		// continuation in the episode's synopsis and the LAST existing scene's
		// actual cinematography (not just its prompt/dialogue), so "vary
		// cinematography from the previous scene" has a real value to vary from.
		const lastPriorScene = priorScenes.at(-1);
		const previousSceneCinematography = lastPriorScene
			? normalizedPlan.scenes.find((meta) => meta.sceneId === lastPriorScene.id)
					?.cinematography
			: undefined;

		const extension = await planService.generateSceneExtension({
			templateKey: project.templateKey,
			audioLanguage: project.audioLanguage,
			subtitleLanguage: project.subtitleLanguage,
			synopsis: project.synopsis ?? "",
			styleBible,
			previousKeyframeDescription,
			previousSceneCinematography,
			existingCharacterNames: normalizedPlan.characters.map((c) => c.name),
			existingLocationKeys: normalizedPlan.locations.map((l) => l.key),
			storySoFar,
			prompt,
		});

		const updatedScene = await sceneRepository.updateById(tx, userId, sceneId, {
			title: extension.scene.title,
			prompt: extension.scene.prompt,
			dialogue: extension.scene.dialogue,
			speakerName: extension.scene.speaker,
			subtitleText: extension.scene.subtitleText,
			durationSeconds: extension.scene.durationSeconds,
			status: SceneStatus.KEYFRAME_PENDING,
		});
		if (!updatedScene) {
			return null;
		}

		// docs §8d(1): the agent now specs new characters/locations fully via
		// `newCharacters`/`newLocation` (packages/api's extendStorySceneSchema)
		// instead of the server fabricating a placeholder from a bare name — a
		// placeholder visualDescription/description used to seed a REAL,
		// binding character/location sheet, permanently off-design. The
		// fabricated-placeholder path inside `mergeExtensionCharacters`/
		// `mergeExtensionLocation` (AI-6c: extracted to lib/extension-plan-merge.ts
		// for bun-testability) is a FALLBACK ONLY, for the (should-be-rare) case
		// the agent references an unknown name without speccing it — logged
		// below so a drifting agent is visible.
		const characterMerge = mergeExtensionCharacters(
			normalizedPlan.characters,
			extension.scene.characterNames,
			extension.newCharacters,
		);
		for (const name of characterMerge.placeholderCharacterNames) {
			console.warn(
				`[generation.service] extend agent referenced unknown character "${name}" for project ${projectId} without a newCharacters spec — falling back to a placeholder design`,
			);
		}

		const locationMerge = mergeExtensionLocation(
			normalizedPlan.locations,
			extension.scene.locationKey,
			extension.newLocation,
		);
		if (locationMerge.placeholderLocationKey) {
			console.warn(
				`[generation.service] extend agent referenced unknown location "${locationMerge.placeholderLocationKey}" for project ${projectId} without a newLocation spec — falling back to a placeholder design`,
			);
		}

		const nextPlan: ProjectPlan = {
			styleBibleSpec: normalizedPlan.styleBibleSpec,
			characters: characterMerge.characters,
			locations: locationMerge.locations,
			scenes: [
				...normalizedPlan.scenes,
				{
					sceneId,
					characterNames: extension.scene.characterNames,
					locationKey: extension.scene.locationKey,
					cinematography: extension.scene.cinematography,
				},
			],
			// Append the new end-anchor keyframe onto the (now-healed) chain —
			// the new scene's start anchor is the CURRENT last entry, unchanged,
			// never regenerated (docs §2).
			keyframes: [...normalizedPlan.keyframes, extension.keyframe],
		};

		const timeline = project.draftTimeline.map((entry) =>
			entry.sceneId === sceneId
				? { ...entry, durationSeconds: updatedScene.durationSeconds }
				: entry,
		);

		const updatedProject = await projectRepository.updateById(
			tx,
			userId,
			projectId,
			{
				plan: nextPlan,
				draftTimeline: timeline,
			},
		);
		if (!updatedProject) {
			return null;
		}

		return { project: updatedProject, scene: updatedScene };
	});

	// RT-3: same "broadcast after commit, never inside the tx" rule as
	// runPlanStep above — this is the scene-extension counterpart, one scene.
	if (result) {
		await notifyProjectEvent(env, {
			type: "scene",
			projectId,
			sceneId: result.scene.id,
			status: SceneStatus.KEYFRAME_PENDING,
			at: Date.now(),
		});
	}

	return result;
}

// ---------------------------------------------------------------------------
// Shared plumbing: task bookkeeping + R2 ingestion
// ---------------------------------------------------------------------------

async function recordGenerationTask(
	tx: UserScopedTx,
	args: {
		userId: string;
		projectId: string;
		sceneId?: string | null;
		kieTaskId: string;
		workflowInstanceId: string;
		kind: GenerationTaskKind;
		stepKey?: string;
	},
): Promise<GenerationTaskRow> {
	return generationTaskRepository.insertGenerationTask(tx, {
		userId: args.userId,
		projectId: args.projectId,
		sceneId: args.sceneId ?? null,
		kieTaskId: args.kieTaskId,
		workflowInstanceId: args.workflowInstanceId,
		kind: args.kind,
		status: GenerationTaskStatus.PENDING,
		stepKey: args.stepKey ?? null,
	});
}

/**
 * Fix-pass W1: idempotency guard for every `create*Task` function below.
 * `stepKey` is the SAME deterministic string the workflow already passes to
 * `step.do(name, ...)` for that create call (scoped by `workflowInstanceId`
 * so it's unique per run) — if a row with this stepKey already exists (a
 * `step.do` replay after the write committed but the return was lost),
 * reuse its kie_task_id instead of minting — and billing — a new one.
 * `stepKey` is optional so callers that don't pass one (none currently, but
 * kept defensive) fall back to the old always-create behavior.
 */
async function reuseTaskByStepKey(
	userId: string,
	stepKey: string | undefined,
): Promise<CreatedTask | null> {
	if (!stepKey) {
		return null;
	}
	const existing = await generationTaskRepository.findByStepKey(
		userId,
		stepKey,
	);
	return existing
		? { taskId: existing.kieTaskId, generationTaskId: existing.id }
		: null;
}

export interface CreatedTask {
	taskId: string;
	generationTaskId: string;
}

/**
 * Fetches a kie.ai result URL and writes it straight to R2 — done OUTSIDE
 * any DB transaction (a Postgres transaction should never sit open across a
 * slow external fetch/upload, especially on pooled `maxUses:1` connections).
 * Streams via `putObject`'s `FixedLengthStream` path when the response
 * carries Content-Length (kie/CDN normally does, docs §4); buffers as a
 * fallback otherwise — acceptable for this pipeline's image/short-video
 * sizes.
 */
/** Fix-pass W3: distinguishes an allowlist rejection from every other
 * ingestion failure, so `fetchAndPutToR2Guarded` can persist the specific
 * `BAD_RESULT_URL` fail_code (packages/kie's `isAllowedResultUrl`) without
 * every other transient fetch/upload error being mislabeled the same way. */
class BadResultUrlError extends Error {}

interface FetchAndPutToR2Args {
	userId: string;
	projectId: string;
	kind: AssetKind;
	resultUrl: string;
}

interface FetchedAsset {
	r2Key: string;
	size: number;
	contentType: string;
}

async function fetchAndPutToR2(
	args: FetchAndPutToR2Args,
): Promise<FetchedAsset> {
	if (!isAllowedResultUrl(args.resultUrl)) {
		throw new BadResultUrlError(
			`Provider result URL host is not allowlisted: ${args.resultUrl}`,
		);
	}
	let response: Response;
	try {
		response = await fetch(args.resultUrl);
	} catch (cause) {
		throw new Error("Failed to fetch provider result URL", { cause });
	}
	if (!response.ok || !response.body) {
		throw new Error(`Provider result URL returned HTTP ${response.status}`);
	}

	const contentType =
		response.headers.get("content-type") ??
		DEFAULT_CONTENT_TYPE_BY_KIND[args.kind];
	const key = buildAssetR2Key({
		userId: args.userId,
		projectId: args.projectId,
		kind: args.kind,
		contentType,
	});

	const contentLengthHeader = response.headers.get("content-length");
	const put = contentLengthHeader
		? await putObject({
				key,
				body: response.body,
				contentType,
				contentLength: Number(contentLengthHeader),
			})
		: await (async () => {
				const buffer = await response.arrayBuffer();
				return putObject({
					key,
					body: buffer,
					contentType,
					contentLength: buffer.byteLength,
				});
			})();

	return { r2Key: put.key, size: put.size, contentType };
}

/**
 * Fix-pass W3: same as `fetchAndPutToR2`, plus persisting a fail_code onto
 * the owning generation_tasks row for EVERY ingest failure (not just the
 * allowlist rejection originally) before rethrowing — GEN-2 (docs
 * ai-architecture-v1.md §5 finding 2): kie.ai has already billed the task by
 * the time any of this runs, so a network/putObject failure here used to
 * leave the row stuck `pending` forever even though the scene/project above
 * it got marked failed separately, corrupting the audit/cost trail. Mirrors
 * fix-pass C4's poll-timeout fix one layer up the stack. Classification
 * itself lives in lib/ingest-failure.ts (pure, unit-tested).
 */
async function fetchAndPutToR2Guarded(
	args: FetchAndPutToR2Args & { generationTaskId: string },
): Promise<FetchedAsset> {
	try {
		return await fetchAndPutToR2(args);
	} catch (error) {
		const { failCode, failMsg } = classifyIngestFailure(
			error,
			(candidate) => candidate instanceof BadResultUrlError,
		);
		await withUser(db, args.userId, (tx) =>
			generationTaskRepository.updateStatus(
				tx,
				args.userId,
				args.generationTaskId,
				GenerationTaskStatus.FAILED,
				{ failCode, failMsg },
			),
		);
		throw error;
	}
}

/**
 * Fix-pass W1 (ingest half): the replay-guard every `ingestX` below opens
 * with. If a `step.do` ingest step is replayed (the write succeeded but the
 * step's return was lost), `assets.source` (the owning generation_tasks row's
 * id — see that column's doc comment) already resolves to a READY asset, so
 * this returns it directly and the caller skips `fetchAndPutToR2Guarded`
 * entirely — no duplicate kie fetch, no duplicate R2 object, no duplicate
 * row. On a genuine first run (no existing asset), falls through to the same
 * fetch-and-put every ingestX did before this fix pass.
 */
async function reuseOrFetchAsset(
	args: FetchAndPutToR2Args & { generationTaskId: string },
): Promise<{
	existing: AssetRow | null;
	r2Key: string;
	size: number;
	contentType: string;
}> {
	const existing = await withUser(db, args.userId, (tx) =>
		assetRepository.findBySource(tx, args.userId, args.generationTaskId),
	);
	if (existing) {
		// Replayed ingest — the asset is already persisted from the first run.
		return {
			contentType: existing.contentType ?? "",
			existing,
			r2Key: existing.r2Key ?? "",
			size: existing.size ?? 0,
		};
	}

	const fetched = await fetchAndPutToR2Guarded(args);
	return { existing: null, ...fetched };
}

/**
 * Fix-pass W7a: the project-existence recheck every `ingestX` runs
 * immediately before `insertAsset` — a project deleted mid-flight (docs edge
 * case list) between task creation and this ingest step would otherwise hit
 * an FK violation on `assets.project_id` (the row is gone, cascade already
 * ran). Mirrors `runPlanStep`/`runExtensionPlanStep`'s "vanished -> return
 * null quietly" pattern instead of throwing.
 */
async function projectStillExists(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<ProjectRow | null> {
	return projectRepository.findById(tx, userId, projectId);
}

// ---------------------------------------------------------------------------
// Sheets (character / location)
// ---------------------------------------------------------------------------

export async function createCharacterSheetTask(args: {
	userId: string;
	projectId: string;
	workflowInstanceId: string;
	character: ProjectPlanCharacter;
	styleBible: string;
	aspectRatio: AspectRatio;
	stepKey?: string;
}): Promise<CreatedTask> {
	const reused = await reuseTaskByStepKey(args.userId, args.stepKey);
	if (reused) {
		return reused;
	}

	const { taskId } = await paced(() =>
		generateImage({
			prompt: promptBuilders.buildCharacterSheetPrompt(
				args.styleBible,
				args.character,
			),
			aspectRatio: args.aspectRatio,
			callBackUrl: resolveKieCallbackUrl(),
		}),
	);

	const task = await withUser(db, args.userId, (tx) =>
		recordGenerationTask(tx, {
			userId: args.userId,
			projectId: args.projectId,
			workflowInstanceId: args.workflowInstanceId,
			kieTaskId: taskId,
			kind: GenerationTaskKind.SHEET,
			stepKey: args.stepKey,
		}),
	);

	return { taskId, generationTaskId: task.id };
}

export async function createLocationSheetTask(args: {
	userId: string;
	projectId: string;
	workflowInstanceId: string;
	location: ProjectPlanLocation;
	styleBible: string;
	/** StyleBibleSpec.lighting (or the compat fallback, lib/plan-compat.ts) —
	 * called out explicitly alongside the location's own timeOfDay (docs
	 * architecture/v2-prompt-craft §3). */
	lightingRule: string;
	aspectRatio: AspectRatio;
	stepKey?: string;
}): Promise<CreatedTask> {
	const reused = await reuseTaskByStepKey(args.userId, args.stepKey);
	if (reused) {
		return reused;
	}

	const { taskId } = await paced(() =>
		generateImage({
			prompt: promptBuilders.buildLocationSheetPrompt(
				args.styleBible,
				args.location,
				args.lightingRule,
			),
			aspectRatio: args.aspectRatio,
			callBackUrl: resolveKieCallbackUrl(),
		}),
	);

	const task = await withUser(db, args.userId, (tx) =>
		recordGenerationTask(tx, {
			userId: args.userId,
			projectId: args.projectId,
			workflowInstanceId: args.workflowInstanceId,
			kieTaskId: taskId,
			kind: GenerationTaskKind.SHEET,
			stepKey: args.stepKey,
		}),
	);

	return { taskId, generationTaskId: task.id };
}

export async function ingestCharacterSheet(args: {
	userId: string;
	projectId: string;
	generationTaskId: string;
	characterName: string;
	resultUrl: string;
}): Promise<AssetRow | null> {
	const { existing, r2Key, size, contentType } = await reuseOrFetchAsset({
		userId: args.userId,
		projectId: args.projectId,
		kind: AssetKind.CHARACTER_SHEET,
		resultUrl: args.resultUrl,
		generationTaskId: args.generationTaskId,
	});

	return withUser(db, args.userId, async (tx) => {
		const project = await projectStillExists(tx, args.userId, args.projectId);
		if (!project) {
			return null;
		}

		const asset =
			existing ??
			(await assetRepository.insertAsset(tx, {
				projectId: args.projectId,
				userId: args.userId,
				kind: AssetKind.CHARACTER_SHEET,
				status: AssetStatus.READY,
				r2Key,
				contentType,
				size,
				source: args.generationTaskId,
			}));

		if (project.plan) {
			const nextPlan: ProjectPlan = {
				...project.plan,
				characters: project.plan.characters.map((character) =>
					character.name === args.characterName
						? { ...character, sheetAssetId: asset.id }
						: character,
				),
			};
			await projectRepository.updateById(tx, args.userId, args.projectId, {
				plan: nextPlan,
			});
		}

		await generationTaskRepository.updateStatus(
			tx,
			args.userId,
			args.generationTaskId,
			GenerationTaskStatus.SUCCESS,
		);
		return asset;
	});
}

export async function ingestLocationSheet(args: {
	userId: string;
	projectId: string;
	generationTaskId: string;
	locationKey: string;
	resultUrl: string;
}): Promise<AssetRow | null> {
	const { existing, r2Key, size, contentType } = await reuseOrFetchAsset({
		userId: args.userId,
		projectId: args.projectId,
		kind: AssetKind.LOCATION_SHEET,
		resultUrl: args.resultUrl,
		generationTaskId: args.generationTaskId,
	});

	return withUser(db, args.userId, async (tx) => {
		const project = await projectStillExists(tx, args.userId, args.projectId);
		if (!project) {
			return null;
		}

		const asset =
			existing ??
			(await assetRepository.insertAsset(tx, {
				projectId: args.projectId,
				userId: args.userId,
				kind: AssetKind.LOCATION_SHEET,
				status: AssetStatus.READY,
				r2Key,
				contentType,
				size,
				source: args.generationTaskId,
			}));

		if (project.plan) {
			const nextPlan: ProjectPlan = {
				...project.plan,
				locations: project.plan.locations.map((location) =>
					location.key === args.locationKey
						? { ...location, sheetAssetId: asset.id }
						: location,
				),
			};
			await projectRepository.updateById(tx, args.userId, args.projectId, {
				plan: nextPlan,
			});
		}

		await generationTaskRepository.updateStatus(
			tx,
			args.userId,
			args.generationTaskId,
			GenerationTaskStatus.SUCCESS,
		);
		return asset;
	});
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/**
 * Resolves the reference images (≤MAX_IMAGE_INPUT_URLS) for one keyframe:
 * the relevant character sheets + location sheet + the previous keyframe
 * (docs §2's coherence mechanism — pixel anchors, not adjectives). Reference
 * selection now follows the KEYFRAME's own `charactersPresent`/`locationKey`
 * (architecture/v2-prompt-craft), not the governing scene's — a keyframe
 * boundary can legitimately show a subset of a scene's cast (e.g. the frame
 * before a character enters). Missing sheets (not yet generated, or their
 * generation failed) are silently skipped rather than failing the whole
 * keyframe — a keyframe with fewer anchors than ideal is still better than no
 * keyframe at all.
 */
export async function buildKeyframeInputUrls(args: {
	userId: string;
	plan: ProjectPlan;
	keyframe: { charactersPresent: string[]; locationKey: string };
	previousKeyframeAssetId: string | null;
}): Promise<string[]> {
	const location = args.plan.locations.find(
		(candidate) => candidate.key === args.keyframe.locationKey,
	);
	const assetIds = [
		...args.plan.characters
			.filter((character) =>
				args.keyframe.charactersPresent.includes(character.name),
			)
			.map((character) => character.sheetAssetId)
			.filter((id): id is string => id !== null),
		...(location?.sheetAssetId ? [location.sheetAssetId] : []),
		...(args.previousKeyframeAssetId ? [args.previousKeyframeAssetId] : []),
	];

	const assets = await withUser(db, args.userId, async (tx) => {
		const rows: AssetRow[] = [];
		for (const assetId of assetIds) {
			const row = await assetRepository.findById(tx, args.userId, assetId);
			if (row) {
				rows.push(row);
			}
		}
		return rows;
	});

	const urls: string[] = [];
	for (const asset of assets) {
		if (!asset.r2Key) {
			continue;
		}
		const signed = await createSignedDownloadUrl({ key: asset.r2Key });
		urls.push(signed.url);
	}

	return urls.slice(0, MAX_IMAGE_INPUT_URLS);
}

export function buildKeyframePrompt(
	styleBible: string,
	keyframe: ProjectPlanKeyframe,
	plan: ProjectPlan,
): string {
	const location = plan.locations.find(
		(candidate) => candidate.key === keyframe.locationKey,
	);
	// docs §8d MEDIUM: `buildKeyframeInputUrls` silently skips a character
	// whose sheet isn't ready yet (missing `sheetAssetId`, or the sheet asset
	// itself failed) rather than blocking the keyframe — this caller is the
	// one place that knows which of THIS keyframe's characters that happened
	// to, so it threads that list into the builder's textual fallback instead
	// of the prompt silently losing their design entirely.
	const sheetlessCharacters = plan.characters.filter(
		(character) =>
			keyframe.charactersPresent.includes(character.name) &&
			!character.sheetAssetId,
	);
	return promptBuilders.buildKeyframePrompt(
		styleBible,
		keyframe,
		location?.description,
		sheetlessCharacters,
	);
}

export async function createKeyframeTask(args: {
	userId: string;
	projectId: string;
	workflowInstanceId: string;
	sceneId: string | null;
	prompt: string;
	aspectRatio: AspectRatio;
	inputUrls: string[];
	stepKey?: string;
}): Promise<CreatedTask> {
	const reused = await reuseTaskByStepKey(args.userId, args.stepKey);
	if (reused) {
		return reused;
	}

	const { taskId } = await paced(() =>
		generateImage({
			prompt: args.prompt,
			aspectRatio: args.aspectRatio,
			inputUrls: args.inputUrls,
			callBackUrl: resolveKieCallbackUrl(),
		}),
	);

	const task = await withUser(db, args.userId, (tx) =>
		recordGenerationTask(tx, {
			userId: args.userId,
			projectId: args.projectId,
			sceneId: args.sceneId,
			workflowInstanceId: args.workflowInstanceId,
			kieTaskId: taskId,
			kind: GenerationTaskKind.KEYFRAME,
			stepKey: args.stepKey,
		}),
	);

	return { taskId, generationTaskId: task.id };
}

export async function ingestKeyframe(args: {
	userId: string;
	projectId: string;
	generationTaskId: string;
	resultUrl: string;
}): Promise<AssetRow | null> {
	const { existing, r2Key, size, contentType } = await reuseOrFetchAsset({
		userId: args.userId,
		projectId: args.projectId,
		kind: AssetKind.KEYFRAME,
		resultUrl: args.resultUrl,
		generationTaskId: args.generationTaskId,
	});

	return withUser(db, args.userId, async (tx) => {
		const project = await projectStillExists(tx, args.userId, args.projectId);
		if (!project) {
			return null;
		}

		const asset =
			existing ??
			(await assetRepository.insertAsset(tx, {
				projectId: args.projectId,
				userId: args.userId,
				kind: AssetKind.KEYFRAME,
				status: AssetStatus.READY,
				r2Key,
				contentType,
				size,
				source: args.generationTaskId,
			}));
		await generationTaskRepository.updateStatus(
			tx,
			args.userId,
			args.generationTaskId,
			GenerationTaskStatus.SUCCESS,
		);
		return asset;
	});
}

export async function attachStartKeyframe(
	userId: string,
	sceneId: string,
	assetId: string,
): Promise<void> {
	await withUser(db, userId, (tx) =>
		sceneRepository.updateById(tx, userId, sceneId, {
			startKeyframeAssetId: assetId,
		}),
	);
}

export async function attachEndKeyframe(
	userId: string,
	sceneId: string,
	assetId: string,
): Promise<void> {
	const outcome = await withUser(db, userId, async (tx) => {
		const scene = await sceneRepository.findById(tx, userId, sceneId);
		if (!scene) {
			return null;
		}
		// The workflow attaches start keyframes before end keyframes within
		// each scene's fencing pair (docs §2's sequential K1..KN+1 pass), so
		// seeing both here means fencing is complete for this scene.
		const becomesReady = Boolean(scene.startKeyframeAssetId);
		const status = becomesReady ? SceneStatus.KEYFRAME_READY : scene.status;
		await sceneRepository.updateById(tx, userId, sceneId, {
			endKeyframeAssetId: assetId,
			status,
		});
		// RT-3: only a REAL keyframe_ready transition is worth a broadcast —
		// re-attaching an end keyframe before the start anchor exists leaves
		// `scene.status` unchanged, nothing for a client to react to.
		return becomesReady ? { projectId: scene.projectId } : null;
	});

	if (outcome) {
		await notifyProjectEvent(env, {
			type: "scene",
			projectId: outcome.projectId,
			sceneId,
			status: SceneStatus.KEYFRAME_READY,
			at: Date.now(),
		});
	}
}

// ---------------------------------------------------------------------------
// Scene videos
// ---------------------------------------------------------------------------

/**
 * Fix-pass W5 (scene status granularity): flips a scene to `video_pending`
 * once its scene-video kie task has actually been CREATED (task id in hand),
 * closing the visibility gap where a scene sat at `keyframe_ready` for the
 * ~1-5 min the video generation was in flight with no way for the UI to
 * distinguish "about to start" from "actually running".
 */
export async function markSceneVideoPending(
	userId: string,
	sceneId: string,
): Promise<void> {
	const updated = await withUser(db, userId, (tx) =>
		sceneRepository.updateById(tx, userId, sceneId, {
			status: SceneStatus.VIDEO_PENDING,
		}),
	);
	if (updated) {
		await notifyProjectEvent(env, {
			type: "scene",
			projectId: updated.projectId,
			sceneId,
			status: SceneStatus.VIDEO_PENDING,
			at: Date.now(),
		});
	}
}

export async function createSceneVideoTask(args: {
	userId: string;
	projectId: string;
	workflowInstanceId: string;
	scene: SceneRow;
	styleBible: string;
	cinematography: ProjectPlanCinematography;
	firstFrameUrl: string;
	/**
	 * Optional (docs last-frame-chaining.md Feature 1): callers no longer pass
	 * this — `firstFrameUrl` alone (the chained real last frame) drives
	 * seedance, so it animates ONE natural action instead of converging on a
	 * second fixed endpoint. Kept optional rather than removed so
	 * packages/kie's `lastFrameUrl?` stays reachable if a future caller wants
	 * fenced generation again.
	 */
	lastFrameUrl?: string;
	aspectRatio: AspectRatio;
	stepKey?: string;
}): Promise<CreatedTask> {
	const reused = await reuseTaskByStepKey(args.userId, args.stepKey);
	if (reused) {
		return reused;
	}

	const { taskId } = await paced(() =>
		generateVideo({
			prompt: promptBuilders.buildSceneVideoPrompt(
				args.styleBible,
				args.cinematography,
				args.scene.prompt,
				args.scene.dialogue ?? undefined,
				args.scene.speakerName,
			),
			firstFrameUrl: args.firstFrameUrl,
			lastFrameUrl: args.lastFrameUrl,
			aspectRatio: args.aspectRatio,
			durationSeconds: args.scene.durationSeconds,
			generateAudio: true,
			callBackUrl: resolveKieCallbackUrl(),
		}),
	);

	const task = await withUser(db, args.userId, (tx) =>
		recordGenerationTask(tx, {
			userId: args.userId,
			projectId: args.projectId,
			sceneId: args.scene.id,
			workflowInstanceId: args.workflowInstanceId,
			kieTaskId: taskId,
			kind: GenerationTaskKind.VIDEO,
			stepKey: args.stepKey,
		}),
	);

	return { taskId, generationTaskId: task.id };
}

export async function ingestSceneVideo(args: {
	userId: string;
	projectId: string;
	sceneId: string;
	generationTaskId: string;
	resultUrl: string;
}): Promise<AssetRow | null> {
	const { existing, r2Key, size, contentType } = await reuseOrFetchAsset({
		userId: args.userId,
		projectId: args.projectId,
		kind: AssetKind.SCENE_VIDEO,
		resultUrl: args.resultUrl,
		generationTaskId: args.generationTaskId,
	});

	const asset = await withUser(db, args.userId, async (tx) => {
		// Fix-pass W7a: this doubles as B1's FOR-UPDATE lock ordering (project
		// lock before scene/asset writes) AND the project-existence guard —
		// vanished mid-flight -> return null quietly instead of hitting an FK
		// violation on assets.project_id.
		const project = await projectRepository.findByIdForUpdate(
			tx,
			args.userId,
			args.projectId,
		);
		if (!project) {
			return null;
		}

		const asset =
			existing ??
			(await assetRepository.insertAsset(tx, {
				projectId: args.projectId,
				userId: args.userId,
				kind: AssetKind.SCENE_VIDEO,
				status: AssetStatus.READY,
				r2Key,
				contentType,
				size,
				source: args.generationTaskId,
			}));

		await sceneRepository.updateById(tx, args.userId, args.sceneId, {
			videoAssetId: asset.id,
			status: SceneStatus.VIDEO_READY,
		});

		// Fixes the "" seeding flag from phase 3b-1: draft_timeline entries
		// were seeded with videoAssetId: "" at creation/extension time since
		// no video asset existed yet — this is where a real one lands.
		const timeline = project.draftTimeline.map((entry) =>
			entry.sceneId === args.sceneId
				? { ...entry, videoAssetId: asset.id }
				: entry,
		);
		await projectRepository.updateById(tx, args.userId, args.projectId, {
			draftTimeline: timeline,
		});

		await generationTaskRepository.updateStatus(
			tx,
			args.userId,
			args.generationTaskId,
			GenerationTaskStatus.SUCCESS,
		);
		return asset;
	});

	// RT-3: broadcast the scene's `video_ready` transition after the
	// transaction committed — the doc's explicit "ingestSceneVideo (→
	// video_ready)" notify point.
	if (asset) {
		await notifyProjectEvent(env, {
			type: "scene",
			projectId: args.projectId,
			sceneId: args.sceneId,
			status: SceneStatus.VIDEO_READY,
			at: Date.now(),
		});
	}

	return asset;
}

/**
 * Feature 1 (docs/last-frame-chaining.md, docs/media-ops-container.md
 * §Feature 1): extracts an already-ingested scene video's REAL last frame
 * via the media-ops ffmpeg container and stores it as a fresh READY
 * `keyframe` asset — the pixel anchor the NEXT scene's video chains its
 * first frame from, instead of the clean-but-static boundary keyframe.
 * `source` stays null (mirrors R1 `render` assets — see `assets.source`'s
 * doc comment in packages/db/src/schema/asset.ts): this asset has no owning
 * generation_tasks row, it's derived from an already-ingested one.
 *
 * Best-effort by design, never throws: any failure (unsigned/missing video
 * URL, media-ops container/ffmpeg error, R2 write failure, project vanished
 * mid-flight) is caught here and this returns null — callers fall back to
 * the scene's own start keyframe (workflows/video-generation.ts's
 * `generateSceneVideo`), so a media-ops hiccup degrades chaining quality
 * without ever failing an already-successful scene's video.
 */
export async function extractAndStoreLastFrame(args: {
	userId: string;
	projectId: string;
	sceneId: string;
	videoAssetId: string;
}): Promise<string | null> {
	try {
		const videoUrl = await resolveAssetDownloadUrl(
			args.userId,
			args.videoAssetId,
		);
		if (!videoUrl) {
			return null;
		}

		const frameBytes = await extractLastFrame(videoUrl);
		const contentType = "image/jpeg";
		const key = buildAssetR2Key({
			userId: args.userId,
			projectId: args.projectId,
			kind: AssetKind.KEYFRAME,
			contentType,
		});
		const put = await putObject({
			key,
			body: frameBytes,
			contentType,
			contentLength: frameBytes.byteLength,
		});

		return await withUser(db, args.userId, async (tx) => {
			const project = await projectStillExists(tx, args.userId, args.projectId);
			if (!project) {
				return null;
			}
			const asset = await assetRepository.insertAsset(tx, {
				projectId: args.projectId,
				userId: args.userId,
				kind: AssetKind.KEYFRAME,
				status: AssetStatus.READY,
				r2Key: put.key,
				contentType,
				size: put.size,
				source: null,
			});
			return asset.id;
		});
	} catch (error) {
		console.error(
			`[generation.service] extractAndStoreLastFrame failed (scene=${args.sceneId})`,
			error,
		);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Feature 2 — subtitle STT sync (docs media-ops-container.md §Feature 2)
// ---------------------------------------------------------------------------

/**
 * Feature 2 (docs media-ops-container.md, last-frame-chaining.md):
 * transcribes an already-ingested scene video via the AI Gateway's
 * `openai/whisper-1` (packages/ai's `transcribeSpeech`) and persists the
 * resulting REAL, speech-timed cues on the scene — so on-screen subtitles sit
 * exactly over the actual spoken audio instead of the word-count estimate
 * (`apps/web`'s `buildSubtitleCues`). Swapped in for kie's
 * `elevenlabs/speech-to-text`, which is 401 UNAUTHORIZED for this account's
 * key (verified against the live API, same failure mode as the ElevenLabs TTS
 * removed earlier). Whisper accepts the scene's mp4 directly — the audio
 * track is extracted provider-side — so this no longer needs `extractAudio`'s
 * media-ops/ffmpeg round trip or an intermediate mp3 R2 upload; Seedance
 * clips run ≤~4MB, well under whisper's 25MB input limit.
 *
 * Best-effort by design, never throws — mirrors `extractAndStoreLastFrame`'s
 * own contract exactly: any failure (unsigned/missing video URL, fetch/
 * transcription error, R2 write failure, project/scene vanished mid-flight)
 * is caught here and this returns `null`. The scene keeps its
 * already-successful `video_ready` status and simply falls back to the
 * estimate — a transcription hiccup never fails an already-successful
 * scene's video.
 *
 * Skips transcription entirely (returns `null` without ever calling the
 * gateway) when the scene has no `dialogue` or no `subtitleText` — Seedance
 * only speaks `dialogue` natively (docs studio-fixes-backlog.md), so a scene
 * without it has no speech to transcribe, and a scene without `subtitleText`
 * has nothing to caption regardless of how good the STT timing would be.
 */
export async function extractAndStoreSceneSubtitles(args: {
	userId: string;
	projectId: string;
	sceneId: string;
	videoAssetId: string;
}): Promise<SpeechCue[] | null> {
	try {
		const scene = await loadScene(args.userId, args.sceneId);
		if (!scene?.dialogue?.trim() || !scene?.subtitleText?.trim()) {
			return null;
		}

		const videoUrl = await resolveAssetDownloadUrl(
			args.userId,
			args.videoAssetId,
		);
		if (!videoUrl) {
			return null;
		}

		const response = await fetch(videoUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch scene video for transcription (HTTP ${response.status})`,
			);
		}
		const videoBytes = new Uint8Array(await response.arrayBuffer());

		const speechCues = await transcribeSpeech(videoBytes);
		if (speechCues.length === 0) {
			return null;
		}

		return await withUser(db, args.userId, async (tx) => {
			const stillExists = await projectStillExists(
				tx,
				args.userId,
				args.projectId,
			);
			if (!stillExists) {
				return null;
			}
			const row = await sceneRepository.updateById(
				tx,
				args.userId,
				args.sceneId,
				{ speechCues },
			);
			return row ? speechCues : null;
		});
	} catch (error) {
		console.error(
			`[generation.service] extractAndStoreSceneSubtitles failed (scene=${args.sceneId})`,
			error,
		);
		return null;
	}
}

/**
 * Translates every scene's existing subtitles (subtitleText + real speechCues,
 * timing preserved) into `target`, persists them, and fires a `scene` SSE event
 * per updated scene so the Player preview refreshes live. Best-effort per scene:
 * one scene's translation failure never blocks the others. Returns how many
 * scenes were updated.
 */
export async function translateAndStoreProjectSubtitles(
	userId: string,
	projectId: string,
	target: SubtitleLanguage,
): Promise<number> {
	const scenes = await loadScenes(userId, projectId);
	let translated = 0;
	for (const scene of scenes) {
		const hasText = Boolean(scene.subtitleText?.trim());
		const hasCues = Boolean(scene.speechCues && scene.speechCues.length > 0);
		if (!hasText && !hasCues) {
			continue;
		}
		try {
			const subtitleText = hasText
				? await translateSubtitleText(scene.subtitleText as string, target)
				: scene.subtitleText;
			const speechCues = hasCues
				? await translateSubtitleCues(scene.speechCues as SpeechCue[], target)
				: scene.speechCues;
			const row = await withUser(db, userId, async (tx) => {
				const stillExists = await projectStillExists(tx, userId, projectId);
				if (!stillExists) {
					return null;
				}
				return sceneRepository.updateById(tx, userId, scene.id, {
					subtitleText,
					speechCues,
				});
			});
			if (!row) {
				continue;
			}
			translated++;
			await notifyProjectEvent(env, {
				type: "scene",
				projectId,
				sceneId: scene.id,
				status: scene.status,
				at: Date.now(),
			});
		} catch (error) {
			console.error(
				`[generation.service] subtitle translation failed (scene=${scene.id})`,
				error,
			);
		}
	}
	return translated;
}

// ---------------------------------------------------------------------------
// Failure handling & finalize
// ---------------------------------------------------------------------------

/**
 * Fix-pass W5 (project status granularity): flips the project to `planning`
 * the moment the project-generation workflow starts its plan step — the
 * project otherwise sat at `draft` for the entire ~1-2 min agent call with no
 * way for the UI to tell "kicked off" from "the request never landed". Only
 * the initial project-generation mode's plan step calls this: `extend()`
 * (project.service.ts, fix-pass B1) already flips the project to
 * `generating` synchronously, inside the same guard transaction that closes
 * the one-active-workflow-per-project race — re-deriving `planning` here for
 * scene-extension would undo that guard.
 */
export async function markProjectPlanning(
	userId: string,
	projectId: string,
): Promise<void> {
	const updated = await withUser(db, userId, (tx) =>
		projectRepository.updateById(tx, userId, projectId, {
			status: ProjectStatus.PLANNING,
		}),
	);
	if (updated) {
		await notifyProjectEvent(env, {
			type: "project",
			projectId,
			status: ProjectStatus.PLANNING,
			at: Date.now(),
		});
	}
}

/**
 * Fix-pass W5: flips the project from `storyboard` (set by `runPlanStep`
 * once the plan is persisted — docs §9's "persist scenes, status storyboard,
 * UI shows editable plan" flow) to `generating` right before the sheets/
 * keyframes/videos phase actually starts kicking off kie.ai tasks.
 */
export async function markProjectGenerating(
	userId: string,
	projectId: string,
): Promise<void> {
	const updated = await withUser(db, userId, (tx) =>
		projectRepository.updateById(tx, userId, projectId, {
			status: ProjectStatus.GENERATING,
		}),
	);
	if (updated) {
		await notifyProjectEvent(env, {
			type: "project",
			projectId,
			status: ProjectStatus.GENERATING,
			at: Date.now(),
		});
	}
}

/** Project-level failure — used when nothing scene-scoped exists yet to
 * blame (e.g. the plan step itself never ran), so the project's status is
 * always resolvable rather than stuck in `planning`/`generating` forever
 * (docs §5c.2). */
export async function markProjectFailed(
	userId: string,
	projectId: string,
	reason: string,
): Promise<void> {
	await withUser(db, userId, (tx) =>
		projectRepository.updateById(tx, userId, projectId, {
			status: ProjectStatus.FAILED,
			failReason: reason,
		}),
	);
}

/** Scene-scoped failure — never project-fatal (docs §5c.1). */
export async function markSceneFailed(
	userId: string,
	sceneId: string,
	reason: string,
): Promise<void> {
	const updated = await withUser(db, userId, (tx) =>
		sceneRepository.updateById(tx, userId, sceneId, {
			status: SceneStatus.FAILED,
			failReason: reason,
		}),
	);
	if (updated) {
		await notifyProjectEvent(env, {
			type: "scene",
			projectId: updated.projectId,
			sceneId,
			status: SceneStatus.FAILED,
			at: Date.now(),
		});
	}
}

/**
 * Fix-pass C3: persists kie.ai's `recordInfo.failCode`/`failMsg` onto the
 * generation_tasks row (full detail, server-side only) whenever the caller
 * has it — a `getTask` failure/timeout, not every failure path has both
 * (e.g. C4's poll-exhaustion path only has a synthetic "TIMEOUT" code, no
 * kie failMsg).
 */
export async function markGenerationTaskFailed(
	userId: string,
	generationTaskId: string,
	failCode?: string,
	failMsg?: string,
): Promise<void> {
	await withUser(db, userId, (tx) =>
		generationTaskRepository.updateStatus(
			tx,
			userId,
			generationTaskId,
			GenerationTaskStatus.FAILED,
			failCode || failMsg ? { failCode, failMsg } : undefined,
		),
	);
}

// Fix-pass C3: re-exported so workflow call sites keep using
// `generationService.formatFailReason(...)` — the real (testable)
// implementation lives in lib/fail-reason.ts, see that file's doc comment.
export { formatFailReason };

/** Which scenes reference a character/location, for failure cascades. */
export function scenesReferencingCharacter(
	plan: ProjectPlan,
	characterName: string,
): string[] {
	return plan.scenes
		.filter((scene) => scene.characterNames.includes(characterName))
		.map((scene) => scene.sceneId);
}

export function scenesReferencingLocation(
	plan: ProjectPlan,
	locationKey: string,
): string[] {
	return plan.scenes
		.filter((scene) => scene.locationKey === locationKey)
		.map((scene) => scene.sceneId);
}

/**
 * Recomputes project status from its scenes' current state (docs §5c.1):
 * `ready` if at least one scene reached `video_ready` (the storyboard shows
 * the rest as failed-in-place with Retry), `failed` only if every scene
 * failed. Reused unchanged by all three workflow modes — an extension/retry
 * failure never regresses an already-successful project back to `failed`,
 * since prior successful scenes still count toward "any ready".
 */
export async function finalizeProject(
	userId: string,
	projectId: string,
): Promise<void> {
	const finalStatus = await withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, projectId);
		if (!project) {
			return null;
		}

		const scenes = await sceneRepository.findManyByProjectId(
			tx,
			userId,
			projectId,
		);
		const anyReady = scenes.some(
			(scene) => scene.status === SceneStatus.VIDEO_READY,
		);
		const status = anyReady ? ProjectStatus.READY : ProjectStatus.FAILED;

		await projectRepository.updateById(tx, userId, projectId, {
			status,
			failReason: anyReady ? null : "All scenes failed to generate.",
		});

		return status;
	});

	if (finalStatus) {
		await notifyProjectEvent(env, {
			type: "project",
			projectId,
			status: finalStatus,
			at: Date.now(),
		});
	}
}
