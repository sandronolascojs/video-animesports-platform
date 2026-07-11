import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { KieTaskRecord } from "@video-platform-challenge/kie";
import { getTask, KieError } from "@video-platform-challenge/kie";
import type {
	AspectRatio,
	ProjectPlan,
	ProjectPlanCharacter,
	ProjectPlanCinematography,
	ProjectPlanKeyframe,
	ProjectPlanLocation,
} from "@video-platform-challenge/types";
import {
	CameraMotion,
	KEYFRAME_COUNT_OFFSET,
	Pacing,
	WorkflowMode,
} from "@video-platform-challenge/types";

import { nextPreviousKeyframeAssetId } from "../lib/keyframe-chain";
import { resolveReusableKeyframeAsset } from "../lib/keyframe-reuse";
import { normalizeProjectPlan } from "../lib/plan-compat";
import type { SceneRow } from "../repositories/scene.repository";
import * as generationService from "../services/generation.service";

/**
 * Trigger payload for a video generation run. Mirrors (by hand — this file
 * and packages/infra/alchemy.run.ts are separate TS programs) the
 * `VideoGenerationWorkflowParams` type declared alongside the `Workflow`
 * binding in alchemy.run.ts. Keep the two in sync.
 *
 * `userId` is threaded explicitly rather than looked up inside the
 * workflow: the workflow has no session, and every DB access must go
 * through `withUser(db, userId, ...)` — the caller (generation.service.ts's
 * kickoff functions) always already has it from `session.user.id`.
 */
export type VideoGenerationWorkflowParams = {
	projectId: string;
	userId: string;
	mode: WorkflowMode;
	/** Required for scene-retry; absent for project-generation/scene-extension. */
	sceneId?: string;
	/** Required for scene-extension (docs scenes-architecture-v3.md A4 "one
	 * workflow per batch") — the N placeholder scene ids inserted by
	 * `project.service.ts::extend`, in batch order; processed sequentially
	 * inside ONE workflow instance. `sceneId` is kept above for back-compat
	 * (scene-retry still uses it; older enqueued instances may too) —
	 * `sceneIds ?? (sceneId ? [sceneId] : [])` normalizes both shapes. */
	sceneIds?: string[];
};

type WorkflowResult = {
	status: "done" | "aborted";
	failed?: boolean;
	reason?: string;
};

// ---------------------------------------------------------------------------
// Shared step plumbing
// ---------------------------------------------------------------------------

/**
 * Wraps a kie.ai-calling step: `KieError.retryable === false` (kie's own
 * 4xx/validation rejections) becomes a `NonRetryableError` so the Workflow
 * fails that step immediately instead of retrying a call that can never
 * succeed; everything else (network errors, 429/5xx) is a normal throw so
 * `step.do`'s own retry policy applies (docs phase 3b-2 design anchor 2).
 */
async function kieStep<T extends Rpc.Serializable<T>>(
	step: WorkflowStep,
	name: string,
	fn: () => Promise<T>,
): Promise<T> {
	return step.do(
		name,
		{
			retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
			timeout: "5 minutes",
		},
		async () => {
			try {
				return await fn();
			} catch (error) {
				if (error instanceof KieError && !error.retryable) {
					throw new NonRetryableError(error.message);
				}
				throw error;
			}
		},
	);
}

// ---------------------------------------------------------------------------
// Poll budgets — no callback mechanism (amendment: the challenge kie.ai API
// key has no webhook/callback access configured; confirmed, not assumed).
// Every kie.ai task's completion is discovered by polling `getTask`, full
// stop, for every task kind in every workflow mode. The `/webhooks/kie`
// route, its HMAC verification (packages/kie/src/webhook.ts), and
// generation-webhook.service.ts all stay in the codebase — wired, tested,
// dormant — for a future key that DOES have callback access (see the
// route's own doc comment in src/index.ts). Nothing in this file calls or
// waits on them anymore.
// ---------------------------------------------------------------------------

interface PollBudget {
	maxAttempts: number;
	/** Leading attempts polled at `initialIntervalSeconds`; every attempt at
	 * or past this index polls at `maxIntervalSeconds` instead — fast early
	 * (most tasks finish well under budget), slower for stragglers so a long
	 * run doesn't burn an excessive number of Workflow steps. */
	rampAttempts: number;
	initialIntervalSeconds: number;
	maxIntervalSeconds: number;
}

// Sheets + keyframes (gpt-image-2, docs §3) — worst case
// 12×10s + 12×30s = 480s = 8 min.
const IMAGE_POLL_BUDGET: PollBudget = {
	maxAttempts: 24,
	rampAttempts: 12,
	initialIntervalSeconds: 10,
	maxIntervalSeconds: 30,
};

// Scene video (Seedance, ~3 min/5s-clip per third-party tests, docs §3) —
// worst case 4×15s + 36×30s = 1140s ≈ 19 min.
const VIDEO_POLL_BUDGET: PollBudget = {
	maxAttempts: 40,
	rampAttempts: 4,
	initialIntervalSeconds: 15,
	maxIntervalSeconds: 30,
};

// TTS (ElevenLabs via kie.ai) — worst case 5×10s + 10×25s = 300s = 5 min.
const SPEECH_POLL_BUDGET: PollBudget = {
	maxAttempts: 15,
	rampAttempts: 5,
	initialIntervalSeconds: 10,
	maxIntervalSeconds: 25,
};

// All three budgets above are calibrated BLIND — no real-key timing data
// exists yet — deliberately generous against kie.ai's own docs. Tune after
// the first real run (docs architecture/v2-voice-pipeline).

function pollDelaySeconds(attempt: number, budget: PollBudget): number {
	return attempt < budget.rampAttempts
		? budget.initialIntervalSeconds
		: budget.maxIntervalSeconds;
}

/**
 * Polls kie.ai's `recordInfo` (via `getTask`) on a `step.sleep`-backed
 * backoff loop until the task reaches `success`/`fail`, or `budget`'s
 * `maxAttempts` is exhausted. `budget` differs by task kind — see the
 * `*_POLL_BUDGET` constants above — since generation time differs by an
 * order of magnitude between an image, a TTS clip, and a Seedance video.
 *
 * Fix-pass C4 (kept): on exhaustion, the owning generation_tasks row is
 * marked `failed` (fail_code "TIMEOUT") BEFORE throwing — without this the
 * row was left `pending` forever even though the workflow step itself
 * fails, which both undercounts real failures for observability and would
 * have blocked W1's step-key idempotency lookup from ever reusing/retrying
 * cleanly.
 *
 * GEN-7: each poll now goes through `kieStep` (the same wrapper
 * `create*Task` calls use) instead of a bare `step.do` — a `getTask` call
 * that comes back a non-retryable `KieError` (e.g. an auth/validation
 * rejection from kie's `recordInfo` endpoint) fast-fails via
 * `NonRetryableError` immediately, instead of burning `step.do`'s default
 * retry policy on a call that can never succeed. The budget/backoff loop
 * itself (attempts, `step.sleep` delays, TIMEOUT-on-exhaustion) is
 * unchanged — this only changes how ONE poll attempt's error is handled.
 */
async function waitForKieTask(
	step: WorkflowStep,
	taskId: string,
	ctx: { userId: string; generationTaskId: string },
	budget: PollBudget,
): Promise<KieTaskRecord> {
	for (let attempt = 0; attempt < budget.maxAttempts; attempt++) {
		const record = await kieStep(
			step,
			`poll-kie-task-${taskId}-${attempt}`,
			() => getTask(taskId),
		);
		if (record.state === "success" || record.state === "fail") {
			return record;
		}
		await step.sleep(
			`poll-wait-${taskId}-${attempt}`,
			`${pollDelaySeconds(attempt, budget)} seconds`,
		);
	}

	const timeoutReason = `kie.ai task ${taskId} timed out waiting for completion`;
	await step.do(`mark-timeout-${taskId}`, () =>
		generationService.markGenerationTaskFailed(
			ctx.userId,
			ctx.generationTaskId,
			"TIMEOUT",
			timeoutReason,
		),
	);
	throw new NonRetryableError(timeoutReason);
}

function normalizeStyleBible(styleBible: unknown): string {
	return typeof styleBible === "string"
		? styleBible
		: JSON.stringify(styleBible ?? "");
}

/**
 * Looks up a scene's cinematography from a (structured, post-compat) plan.
 * Every plan reaching this point has already gone through
 * `normalizeProjectPlan` or was freshly generated this run (always
 * structured — see that helper's doc comment for exactly which call sites
 * need the compat pass) — the local default here is a last-resort fallback
 * for the case a sceneId genuinely isn't in `plan.scenes` (shouldn't happen,
 * kept defensive rather than throwing mid-workflow).
 */
function resolveCinematography(
	plan: ProjectPlan,
	sceneId: string,
	fallbackPrompt: string,
): ProjectPlanCinematography {
	return (
		plan.scenes.find((meta) => meta.sceneId === sceneId)?.cinematography ?? {
			cameraMotion: CameraMotion.STATIC,
			motionNotes: fallbackPrompt,
			pacing: Pacing.BUILDING,
		}
	);
}

/**
 * Generates one keyframe for a single scene's start OR end anchor and
 * attaches it — used by scene-extension (the new end keyframe) and
 * scene-retry (whichever anchor is missing). NOT used by the main
 * project-generation keyframe pass, where one generated image is shared
 * between two adjacent scenes (see `runKeyframesPhase` below) — attaching
 * the same image to unrelated start/end anchors here would be wrong.
 */
async function generateAndAttachKeyframe(
	step: WorkflowStep,
	args: {
		userId: string;
		projectId: string;
		workflowInstanceId: string;
		sceneId: string;
		plan: ProjectPlan;
		keyframe: ProjectPlanKeyframe;
		styleBible: string;
		aspectRatio: AspectRatio;
		previousKeyframeAssetId: string | null;
		attach: "start" | "end";
	},
): Promise<{ assetId: string | null; failCode?: string }> {
	let assetId: string | null = null;
	try {
		const inputUrls = await step.do(
			`keyframe-refs-${args.attach}-${args.sceneId}`,
			() =>
				generationService.buildKeyframeInputUrls({
					userId: args.userId,
					plan: args.plan,
					keyframe: args.keyframe,
					previousKeyframeAssetId: args.previousKeyframeAssetId,
				}),
		);
		const prompt = generationService.buildKeyframePrompt(
			args.styleBible,
			args.keyframe,
			args.plan,
		);
		const { taskId, generationTaskId } = await kieStep(
			step,
			`create-keyframe-${args.attach}-${args.sceneId}`,
			() =>
				generationService.createKeyframeTask({
					userId: args.userId,
					projectId: args.projectId,
					workflowInstanceId: args.workflowInstanceId,
					sceneId: args.sceneId,
					prompt,
					aspectRatio: args.aspectRatio,
					inputUrls,
					stepKey: `${args.workflowInstanceId}:create-keyframe-${args.attach}-${args.sceneId}`,
				}),
		);
		const record = await waitForKieTask(
			step,
			taskId,
			{ userId: args.userId, generationTaskId },
			IMAGE_POLL_BUDGET,
		);
		const url = record.resultUrls[0];
		if (record.state !== "success" || !url) {
			await step.do(
				`mark-keyframe-task-failed-${args.attach}-${args.sceneId}`,
				() =>
					generationService.markGenerationTaskFailed(
						args.userId,
						generationTaskId,
						record.failCode,
						record.failMsg,
					),
			);
			return { assetId: null, failCode: record.failCode };
		}
		const asset = await step.do(
			`ingest-keyframe-${args.attach}-${args.sceneId}`,
			() =>
				generationService.ingestKeyframe({
					userId: args.userId,
					projectId: args.projectId,
					generationTaskId,
					resultUrl: url,
				}),
		);
		// Fix-pass W7a: `ingestKeyframe` now returns null when the project
		// vanished mid-flight (deleted between task creation and this ingest
		// step) instead of throwing on an FK violation — treat it the same as
		// any other keyframe failure.
		assetId = asset ? asset.id : null;
	} catch (error) {
		console.error(
			`[VideoGenerationWorkflow] keyframe generation failed (${args.attach}, scene=${args.sceneId})`,
			error,
		);
		return { assetId: null };
	}

	if (args.attach === "start") {
		await step.do(`attach-start-keyframe-${args.sceneId}`, () =>
			generationService.attachStartKeyframe(
				args.userId,
				args.sceneId,
				assetId as string,
			),
		);
	} else {
		await step.do(`attach-end-keyframe-${args.sceneId}`, () =>
			generationService.attachEndKeyframe(
				args.userId,
				args.sceneId,
				assetId as string,
			),
		);
	}
	return { assetId };
}

/**
 * Fix-pass W9a: the character/location sheet create-task -> wait -> ingest
 * (or mark-failed) sequence, previously duplicated 4x — once per kind
 * (character/location) x once per mode (project-generation's main sheet
 * loops, scene-extension's "only if sheetAssetId is still null" blocks).
 * Mirrors `generateAndAttachKeyframe`'s shape: swallow failures internally
 * (a missing sheet degrades keyframe quality rather than blocking
 * generation, docs §2) so callers can simply `await` this in a loop.
 * `stepSuffix` must be unique per call site within one workflow run (the
 * project-generation loops pass the character name / location key; the
 * extension blocks prefix with `ext-`) — kept as a caller-supplied string
 * rather than derived here so step.do names stay stable across this
 * refactor's call sites.
 */
type SheetTarget =
	| { kind: "character"; character: ProjectPlanCharacter }
	| { kind: "location"; location: ProjectPlanLocation };

async function generateAndIngestSheet(
	step: WorkflowStep,
	args: {
		userId: string;
		projectId: string;
		workflowInstanceId: string;
		styleBible: string;
		/** Only consumed for `target.kind === "location"`. */
		lightingRule: string;
		aspectRatio: AspectRatio;
		target: SheetTarget;
		stepSuffix: string;
	},
): Promise<void> {
	const { target } = args;
	const label =
		target.kind === "character" ? target.character.name : target.location.key;
	try {
		const { taskId, generationTaskId } = await kieStep(
			step,
			`create-${target.kind}-sheet-${args.stepSuffix}`,
			() =>
				target.kind === "character"
					? generationService.createCharacterSheetTask({
							userId: args.userId,
							projectId: args.projectId,
							workflowInstanceId: args.workflowInstanceId,
							character: target.character,
							styleBible: args.styleBible,
							aspectRatio: args.aspectRatio,
							stepKey: `${args.workflowInstanceId}:create-${target.kind}-sheet-${args.stepSuffix}`,
						})
					: generationService.createLocationSheetTask({
							userId: args.userId,
							projectId: args.projectId,
							workflowInstanceId: args.workflowInstanceId,
							location: target.location,
							styleBible: args.styleBible,
							lightingRule: args.lightingRule,
							aspectRatio: args.aspectRatio,
							stepKey: `${args.workflowInstanceId}:create-${target.kind}-sheet-${args.stepSuffix}`,
						}),
		);
		const record = await waitForKieTask(
			step,
			taskId,
			{ userId: args.userId, generationTaskId },
			IMAGE_POLL_BUDGET,
		);
		const url = record.resultUrls[0];
		if (record.state === "success" && url) {
			await step.do(`ingest-${target.kind}-sheet-${args.stepSuffix}`, () =>
				target.kind === "character"
					? generationService.ingestCharacterSheet({
							userId: args.userId,
							projectId: args.projectId,
							generationTaskId,
							characterName: target.character.name,
							resultUrl: url,
						})
					: generationService.ingestLocationSheet({
							userId: args.userId,
							projectId: args.projectId,
							generationTaskId,
							locationKey: target.location.key,
							resultUrl: url,
						}),
			);
		} else {
			await step.do(
				`mark-sheet-task-failed-${target.kind}-${args.stepSuffix}`,
				() =>
					generationService.markGenerationTaskFailed(
						args.userId,
						generationTaskId,
						record.failCode,
						record.failMsg,
					),
			);
		}
	} catch (error) {
		console.error(
			`[VideoGenerationWorkflow] ${target.kind} sheet failed: ${label}`,
			error,
		);
	}
}

/**
 * Generates + ingests a scene's TTS dialogue track FIRST (architecture/
 * v2-voice-pipeline), then generates + ingests the scene's video from its
 * (already-attached) fencing keyframes, handing Seedance the TTS track as
 * `reference_audio_urls` so the character lip-syncs to it. Order matters:
 * the video task can't reference audio that doesn't exist yet.
 *
 * TTS is non-fatal end to end — task-creation failure, poll timeout, a
 * failed kie.ai state, or a duration out of Seedance's reference-audio
 * bounds (`isReferenceAudioDurationValid`) all fall through to generating
 * the video WITHOUT a reference track (`referenceAudioUrl` stays `null`).
 * The scene still keeps no `audio_asset_id` in that case, but dialogue is
 * NOT silently lost: `createSceneVideoTask` always forwards
 * `scene.dialogue` into the video prompt, just with the "speak it yourself"
 * wording instead of the "lip-sync to this reference" wording when there's
 * no track (see `promptBuilders.buildSceneVideoPrompt`) — voice is an
 * enhancement, never a generation blocker.
 *
 * Video failure IS fatal to the scene (unchanged from before this reorder).
 */
async function generateSceneSpeechAndVideo(
	step: WorkflowStep,
	args: {
		userId: string;
		projectId: string;
		workflowInstanceId: string;
		scene: SceneRow;
		styleBible: string;
		cinematography: ProjectPlanCinematography;
		aspectRatio: AspectRatio;
		audioLanguage: Parameters<
			typeof generationService.createSceneSpeechTask
		>[0]["audioLanguage"];
		/** The project's plan characters — resolves the scene's speaker to
		 * their fixed, deterministically-cast voice (docs
		 * scenes-architecture-v3.md A3). */
		characters: ProjectPlanCharacter[];
	},
): Promise<{ succeeded: boolean }> {
	let referenceAudioUrl: string | null = null;
	try {
		const created = await kieStep(step, `create-speech-${args.scene.id}`, () =>
			generationService.createSceneSpeechTask({
				userId: args.userId,
				projectId: args.projectId,
				workflowInstanceId: args.workflowInstanceId,
				scene: args.scene,
				audioLanguage: args.audioLanguage,
				characters: args.characters,
				stepKey: `${args.workflowInstanceId}:create-speech-${args.scene.id}`,
			}),
		);
		if (created) {
			const record = await waitForKieTask(
				step,
				created.taskId,
				{ userId: args.userId, generationTaskId: created.generationTaskId },
				SPEECH_POLL_BUDGET,
			);
			const url = record.resultUrls[0];
			if (record.state === "success" && url) {
				const asset = await step.do(`ingest-speech-${args.scene.id}`, () =>
					generationService.ingestSceneSpeech({
						userId: args.userId,
						projectId: args.projectId,
						sceneId: args.scene.id,
						generationTaskId: created.generationTaskId,
						resultUrl: url,
						dialogueText: args.scene.dialogue,
					}),
				);
				if (
					asset &&
					generationService.isReferenceAudioDurationValid(
						asset,
						args.scene.durationSeconds,
					)
				) {
					referenceAudioUrl = await step.do(
						`sign-speech-${args.scene.id}`,
						() =>
							generationService.resolveAssetDownloadUrl(args.userId, asset.id),
					);
				} else if (asset) {
					console.error(
						`[VideoGenerationWorkflow] TTS asset duration out of Seedance's reference-audio bounds, skipping as lip-sync reference (scene=${args.scene.id})`,
					);
				}
			} else {
				await step.do(`mark-speech-task-failed-${args.scene.id}`, () =>
					generationService.markGenerationTaskFailed(
						args.userId,
						created.generationTaskId,
						record.failCode,
						record.failMsg,
					),
				);
			}
		}
	} catch (error) {
		// Non-fatal (architecture/v2-voice-pipeline): the scene video below
		// still generates without a reference-audio lip-sync track on any TTS
		// failure — dialogue still gets spoken via Seedance's own
		// `generate_audio`, just not lip-synced to a pre-rendered clip.
		console.error(
			`[VideoGenerationWorkflow] scene speech failed (non-fatal): ${args.scene.id}`,
			error,
		);
	}

	try {
		const firstFrameUrl = await step.do(
			`sign-start-keyframe-${args.scene.id}`,
			() =>
				generationService.resolveAssetDownloadUrl(
					args.userId,
					args.scene.startKeyframeAssetId as string,
				),
		);
		const lastFrameUrl = await step.do(
			`sign-end-keyframe-${args.scene.id}`,
			() =>
				generationService.resolveAssetDownloadUrl(
					args.userId,
					args.scene.endKeyframeAssetId as string,
				),
		);
		if (!firstFrameUrl || !lastFrameUrl) {
			throw new Error("Could not resolve keyframe download URLs");
		}

		const { taskId, generationTaskId } = await kieStep(
			step,
			`create-video-${args.scene.id}`,
			() =>
				generationService.createSceneVideoTask({
					userId: args.userId,
					projectId: args.projectId,
					workflowInstanceId: args.workflowInstanceId,
					scene: args.scene,
					styleBible: args.styleBible,
					cinematography: args.cinematography,
					firstFrameUrl,
					lastFrameUrl,
					aspectRatio: args.aspectRatio,
					referenceAudioUrl,
					stepKey: `${args.workflowInstanceId}:create-video-${args.scene.id}`,
				}),
		);
		// Fix-pass W5: the video task has been CREATED (kie taskId in hand) —
		// flip the scene from keyframe_ready to video_pending so the UI can
		// distinguish "about to start" from "actually generating" instead of
		// sitting at keyframe_ready for the whole poll wait below.
		await step.do(`mark-scene-video-pending-${args.scene.id}`, () =>
			generationService.markSceneVideoPending(args.userId, args.scene.id),
		);
		const record = await waitForKieTask(
			step,
			taskId,
			{ userId: args.userId, generationTaskId },
			VIDEO_POLL_BUDGET,
		);
		const url = record.resultUrls[0];
		if (record.state !== "success" || !url) {
			console.error(
				`[VideoGenerationWorkflow] scene video did not succeed: ${args.scene.id} (state=${record.state}, failCode=${record.failCode})`,
			);
			await step.do(`mark-video-task-failed-${args.scene.id}`, () =>
				generationService.markGenerationTaskFailed(
					args.userId,
					generationTaskId,
					record.failCode,
					record.failMsg,
				),
			);
			await step.do(`mark-scene-failed-video-${args.scene.id}`, () =>
				generationService.markSceneFailed(
					args.userId,
					args.scene.id,
					generationService.formatFailReason(
						"Video generation failed.",
						record.failCode,
					),
				),
			);
			return { succeeded: false };
		}
		await step.do(`ingest-video-${args.scene.id}`, () =>
			generationService.ingestSceneVideo({
				userId: args.userId,
				projectId: args.projectId,
				sceneId: args.scene.id,
				generationTaskId,
				resultUrl: url,
			}),
		);
	} catch (error) {
		console.error(
			`[VideoGenerationWorkflow] scene video failed: ${args.scene.id}`,
			error,
		);
		await step.do(`mark-scene-failed-video-${args.scene.id}`, () =>
			generationService.markSceneFailed(
				args.userId,
				args.scene.id,
				"Video generation failed.",
			),
		);
		return { succeeded: false };
	}

	return { succeeded: true };
}

// ---------------------------------------------------------------------------
// Mode: project-generation
// ---------------------------------------------------------------------------

async function runProjectGenerationMode(
	step: WorkflowStep,
	ctx: { userId: string; projectId: string; workflowInstanceId: string },
): Promise<WorkflowResult> {
	const { userId, projectId, workflowInstanceId } = ctx;

	// Fix-pass W5: `draft` -> `planning` the moment this mode's plan step
	// actually starts — the agent call below takes ~1-2 min with nothing else
	// to show for it otherwise.
	await step.do("mark-planning", () =>
		generationService.markProjectPlanning(userId, projectId),
	);

	const planResult = await step.do("plan", () =>
		generationService.runPlanStep(userId, projectId),
	);
	if (!planResult) {
		return { status: "aborted", reason: "project-not-found" };
	}
	const { project, scenes } = planResult;
	if (!project.plan) {
		throw new NonRetryableError(
			"Plan step completed without persisting a plan",
		);
	}
	const styleBible = normalizeStyleBible(project.styleBible);
	const aspectRatio = project.aspectRatio;
	// `project.plan` is freshly generated by the plan step above THIS run —
	// always fully structured (storyPlanSchema's zod bounds guarantee it), so
	// no lib/plan-compat.ts normalization pass is needed here (unlike
	// scene-retry mode, which can read an older project's plan).
	const lightingRule = project.plan.styleBibleSpec.lighting;

	// Fix-pass W5: `runPlanStep` itself persisted `storyboard` (plan visible,
	// nothing generated yet) — flip to `generating` right before the first
	// kie.ai task of this run gets created.
	await step.do("mark-generating", () =>
		generationService.markProjectGenerating(userId, projectId),
	);

	// ---- sheets: one text-to-image call per character/location. Missing
	// sheets degrade keyframe quality (buildKeyframeInputUrls skips absent
	// refs) rather than blocking generation — see that function's doc
	// comment (docs §2 pixel-anchor mechanism is a quality lever, not a hard
	// gate on feasibility). Fix-pass W9a: both loops delegate to
	// `generateAndIngestSheet` (previously ~45 duplicated lines each).
	for (const character of project.plan.characters) {
		await generateAndIngestSheet(step, {
			userId,
			projectId,
			workflowInstanceId,
			styleBible,
			lightingRule,
			aspectRatio,
			target: { kind: "character", character },
			stepSuffix: character.name,
		});
	}

	for (const location of project.plan.locations) {
		await generateAndIngestSheet(step, {
			userId,
			projectId,
			workflowInstanceId,
			styleBible,
			lightingRule,
			aspectRatio,
			target: { kind: "location", location },
			stepSuffix: location.key,
		});
	}

	const projectAfterSheets = await step.do("reload-project-after-sheets", () =>
		generationService.loadProject(userId, projectId),
	);
	const plan = projectAfterSheets?.plan ?? project.plan;

	// ---- keyframes: K1..KN+1, sequential (each i2i uses the previous
	// keyframe as a ref, so this MUST be sequential — docs §2). Keyframe K_i
	// is the start frame of scene i (1-indexed, i<=N) and the end frame of
	// scene i-1 (i>1); K_{N+1} is only an end frame, so it borrows the LAST
	// scene's character/location context for its prompt/refs (a documented
	// simplification — a fully dual-scene-context rule was judged not worth
	// the added complexity for this phase, see phase report deviations).
	const orderedScenes = project.draftTimeline
		.map((entry) => scenes.find((scene) => scene.id === entry.sceneId))
		.filter((scene): scene is SceneRow => scene !== undefined);
	const sceneCount = orderedScenes.length;
	const keyframeCount = sceneCount + KEYFRAME_COUNT_OFFSET;
	const failedSceneIds = new Set<string>();
	let previousKeyframeAssetId: string | null = null;

	for (let index = 1; index <= keyframeCount; index++) {
		const governingIndex = Math.min(index, sceneCount) - 1;
		const governingScene = orderedScenes[governingIndex];
		if (!governingScene) {
			continue;
		}
		// The keyframe's OWN entry (docs architecture/v2-prompt-craft) — not
		// derived from the governing scene's sceneMeta. `governingScene` still
		// picks WHICH scene this keyframe attaches to (start/end), but its
		// visual content (description/shotScale/cameraAngle/cast/location) is
		// the LLM-authored chain entry itself.
		const keyframe = plan.keyframes[index - 1];
		if (!keyframe) {
			continue;
		}

		let keyframeAssetId: string | null = null;
		let keyframeFailCode: string | undefined;
		try {
			const inputUrls = await step.do(`keyframe-refs-${index}`, () =>
				generationService.buildKeyframeInputUrls({
					userId,
					plan,
					keyframe,
					previousKeyframeAssetId,
				}),
			);
			const prompt = generationService.buildKeyframePrompt(
				styleBible,
				keyframe,
				plan,
			);
			const { taskId, generationTaskId } = await kieStep(
				step,
				`create-keyframe-${index}`,
				() =>
					generationService.createKeyframeTask({
						userId,
						projectId,
						workflowInstanceId,
						sceneId: governingScene.id,
						prompt,
						aspectRatio,
						inputUrls,
						stepKey: `${workflowInstanceId}:create-keyframe-${index}`,
					}),
			);
			const record = await waitForKieTask(
				step,
				taskId,
				{ userId, generationTaskId },
				IMAGE_POLL_BUDGET,
			);
			const url = record.resultUrls[0];
			if (record.state !== "success" || !url) {
				await step.do(`mark-keyframe-task-failed-${index}`, () =>
					generationService.markGenerationTaskFailed(
						userId,
						generationTaskId,
						record.failCode,
						record.failMsg,
					),
				);
				keyframeFailCode = record.failCode;
				throw new Error(
					`keyframe ${index} did not succeed (state=${record.state})`,
				);
			}
			const asset = await step.do(`ingest-keyframe-${index}`, () =>
				generationService.ingestKeyframe({
					userId,
					projectId,
					generationTaskId,
					resultUrl: url,
				}),
			);
			// Fix-pass W7a: null means the project vanished mid-flight — treat
			// the same as any other keyframe failure below.
			keyframeAssetId = asset ? asset.id : null;
		} catch (error) {
			console.error(
				`[VideoGenerationWorkflow] keyframe ${index} failed`,
				error,
			);
			keyframeAssetId = null;
		}

		if (keyframeAssetId) {
			const assetId = keyframeAssetId;
			if (index <= sceneCount) {
				const startScene = orderedScenes[index - 1];
				if (startScene) {
					await step.do(`attach-start-keyframe-${index}`, () =>
						generationService.attachStartKeyframe(
							userId,
							startScene.id,
							assetId,
						),
					);
				}
			}
			if (index > 1) {
				const endScene = orderedScenes[index - 2];
				if (endScene) {
					await step.do(`attach-end-keyframe-${index}`, () =>
						generationService.attachEndKeyframe(userId, endScene.id, assetId),
					);
				}
			}
		} else {
			if (index <= sceneCount) {
				const startScene = orderedScenes[index - 1];
				if (startScene && !failedSceneIds.has(startScene.id)) {
					failedSceneIds.add(startScene.id);
					await step.do(`mark-scene-failed-start-kf-${index}`, () =>
						generationService.markSceneFailed(
							userId,
							startScene.id,
							generationService.formatFailReason(
								`Keyframe ${index} failed to generate.`,
								keyframeFailCode,
							),
						),
					);
				}
			}
			if (index > 1) {
				const endScene = orderedScenes[index - 2];
				if (endScene && !failedSceneIds.has(endScene.id)) {
					failedSceneIds.add(endScene.id);
					await step.do(`mark-scene-failed-end-kf-${index}`, () =>
						generationService.markSceneFailed(
							userId,
							endScene.id,
							generationService.formatFailReason(
								`Keyframe ${index} failed to generate.`,
								keyframeFailCode,
							),
						),
					);
				}
			}
		}

		// Invariant (MAJOR fix): only advance the i2i reference on an actual
		// success — on failure, keep the last successfully-generated asset id
		// as a best-effort degraded reference instead of silently dropping the
		// pixel anchor for the NEXT keyframe (see lib/keyframe-chain.ts).
		previousKeyframeAssetId = nextPreviousKeyframeAssetId(
			keyframeAssetId,
			previousKeyframeAssetId,
		);
	}

	// ---- videos + speech, per scene (skip scenes already failed above).
	for (const scene of orderedScenes) {
		if (failedSceneIds.has(scene.id)) {
			continue;
		}

		const fresh = await step.do(`reload-scene-${scene.id}`, () =>
			generationService.loadScene(userId, scene.id),
		);
		if (!fresh?.startKeyframeAssetId || !fresh.endKeyframeAssetId) {
			await step.do(`mark-scene-failed-missing-kf-${scene.id}`, () =>
				generationService.markSceneFailed(
					userId,
					scene.id,
					"Missing keyframe anchor(s).",
				),
			);
			continue;
		}

		await generateSceneSpeechAndVideo(step, {
			userId,
			projectId,
			workflowInstanceId,
			scene: fresh,
			styleBible,
			cinematography: resolveCinematography(plan, scene.id, scene.prompt),
			aspectRatio,
			audioLanguage: project.audioLanguage,
			characters: plan.characters,
		});
	}

	await step.do("finalize", () =>
		generationService.finalizeProject(userId, projectId),
	);
	return { status: "done" };
}

// ---------------------------------------------------------------------------
// Mode: scene-extension
// ---------------------------------------------------------------------------

/**
 * Runs the existing single-scene extension routine (extendStory agent ->
 * keyframe -> video -> speech) for exactly ONE scene id. Every `step.do` name
 * in this function is suffixed with `sceneId` so it stays unique when the
 * batch loop below (`runSceneExtensionMode`) calls this multiple times
 * within the SAME workflow instance — Workflows key step idempotency/replay
 * by step name, so two scenes sharing a bare name like "extension-plan"
 * would collide across the batch. Does NOT call `finalizeProject` itself —
 * the batch loop finalizes exactly once, after every scene has run.
 */
async function runSingleSceneExtension(
	step: WorkflowStep,
	ctx: {
		userId: string;
		projectId: string;
		sceneId: string;
		workflowInstanceId: string;
	},
): Promise<WorkflowResult> {
	const { userId, projectId, sceneId, workflowInstanceId } = ctx;

	const planResult = await step.do(`extension-plan-${sceneId}`, () =>
		generationService.runExtensionPlanStep(userId, projectId, sceneId),
	);
	if (!planResult) {
		return { status: "aborted", reason: "project-or-scene-not-found" };
	}
	const { project } = planResult;
	if (!project.plan) {
		throw new NonRetryableError(
			"Extension plan step completed without a project plan",
		);
	}
	const sceneMeta = project.plan.scenes.find(
		(meta) => meta.sceneId === sceneId,
	);
	if (!sceneMeta) {
		throw new NonRetryableError("Extension scene metadata missing from plan");
	}
	const styleBible = normalizeStyleBible(project.styleBible);
	const aspectRatio = project.aspectRatio;
	// `project.plan` here is `runExtensionPlanStep`'s ALREADY-HEALED result
	// (lib/plan-compat.ts's normalizeProjectPlan ran inside that step) —
	// always fully structured, no further compat pass needed in this mode.
	const lightingRule = project.plan.styleBibleSpec.lighting;

	// New characters/locations the extension introduced (sheetAssetId still
	// null) get sheets generated here — existing ones are reused as-is
	// (docs §2: "existing assets never regenerate").
	// Fix-pass W9a: both blocks delegate to `generateAndIngestSheet` — same
	// helper the project-generation mode's sheet loops use above.
	// The suffix includes `sceneId` (reliability fix): two scenes in one
	// batch can both reference the same still-unresolved character/location
	// (its first sheet attempt failed, sheetAssetId stayed null) — a bare
	// `ext-${name}` would then repeat an identical step.do name within this
	// instance and the replay engine would serve the later scene the earlier
	// scene's cached (failed) result instead of actually retrying.
	for (const name of sceneMeta.characterNames) {
		const character = project.plan.characters.find(
			(candidate) => candidate.name === name,
		);
		if (!character || character.sheetAssetId) {
			continue;
		}
		await generateAndIngestSheet(step, {
			userId,
			projectId,
			workflowInstanceId,
			styleBible,
			lightingRule,
			aspectRatio,
			target: { kind: "character", character },
			stepSuffix: `ext-${sceneId}-${name}`,
		});
	}

	const location = project.plan.locations.find(
		(candidate) => candidate.key === sceneMeta.locationKey,
	);
	if (location && !location.sheetAssetId) {
		await generateAndIngestSheet(step, {
			userId,
			projectId,
			workflowInstanceId,
			styleBible,
			lightingRule,
			aspectRatio,
			target: { kind: "location", location },
			stepSuffix: `ext-${sceneId}-${location.key}`,
		});
	}

	const projectAfterSheets = await step.do(
		`reload-project-after-ext-sheets-${sceneId}`,
		() => generationService.loadProject(userId, projectId),
	);
	const plan = projectAfterSheets?.plan ?? project.plan;

	// Chain from the CURRENT last end keyframe (docs §2): the scene BEFORE
	// this one in draft_timeline order already has a ready end keyframe —
	// reused as-is, never regenerated.
	const allScenes = await step.do(`load-scenes-ext-${sceneId}`, () =>
		generationService.loadScenes(userId, projectId),
	);
	const orderedIds = project.draftTimeline.map((entry) => entry.sceneId);
	const sceneIndex = orderedIds.indexOf(sceneId);
	const previousSceneId =
		sceneIndex > 0 ? orderedIds[sceneIndex - 1] : undefined;
	const previousScene = previousSceneId
		? allScenes.find((scene) => scene.id === previousSceneId)
		: undefined;

	if (!previousScene?.endKeyframeAssetId) {
		await step.do(`mark-scene-failed-ext-no-anchor-${sceneId}`, () =>
			generationService.markSceneFailed(
				userId,
				sceneId,
				"No prior scene end keyframe to chain from.",
			),
		);
		return { status: "done", failed: true };
	}

	// Attach the reused start anchor FIRST (docs §2: the new scene's first
	// frame IS the previous scene's end keyframe — reused, never
	// regenerated), so attachEndKeyframe below sees both anchors present and
	// flips the scene to keyframe_ready.
	await step.do(`attach-ext-start-keyframe-${sceneId}`, () =>
		generationService.attachStartKeyframe(
			userId,
			sceneId,
			previousScene.endKeyframeAssetId as string,
		),
	);

	// The new scene's end anchor: `runExtensionPlanStep` already appended it
	// as the LAST entry of `plan.keyframes` (docs architecture/
	// v2-prompt-craft) — the agent authored it directly, chained from the
	// previous last keyframe's description, so it's used as-is rather than
	// re-derived from sceneMeta.
	const newKeyframe = plan.keyframes.at(-1);
	if (!newKeyframe) {
		throw new NonRetryableError(
			"Extension plan step did not append a new keyframe",
		);
	}

	const { assetId: newKeyframeAssetId, failCode: extKeyframeFailCode } =
		await generateAndAttachKeyframe(step, {
			userId,
			projectId,
			workflowInstanceId,
			sceneId,
			plan,
			keyframe: newKeyframe,
			styleBible,
			aspectRatio,
			previousKeyframeAssetId: previousScene.endKeyframeAssetId,
			attach: "end",
		});

	if (!newKeyframeAssetId) {
		await step.do(`mark-scene-failed-ext-kf-${sceneId}`, () =>
			generationService.markSceneFailed(
				userId,
				sceneId,
				generationService.formatFailReason(
					"Keyframe generation failed.",
					extKeyframeFailCode,
				),
			),
		);
		return { status: "done", failed: true };
	}

	const freshScene = await step.do(`reload-ext-scene-${sceneId}`, () =>
		generationService.loadScene(userId, sceneId),
	);
	if (!freshScene) {
		return { status: "aborted", reason: "scene-not-found" };
	}

	await generateSceneSpeechAndVideo(step, {
		userId,
		projectId,
		workflowInstanceId,
		scene: freshScene,
		styleBible,
		cinematography: resolveCinematography(plan, sceneId, freshScene.prompt),
		aspectRatio,
		audioLanguage: project.audioLanguage,
		characters: plan.characters,
	});

	return { status: "done" };
}

/**
 * Batch entrypoint for `SCENE_EXTENSION` (docs scenes-architecture-v3.md A4
 * "one workflow per batch fixes a real race"): `sceneIds` are the N
 * placeholder rows `project.service.ts::extend` inserted, in batch order.
 * Processed with a plain sequential `for..of` — NOT `Promise.all` — because
 * each scene's full extendStory -> keyframe -> video -> speech routine must
 * finish (and leave its own end keyframe attached) before the next scene's
 * extendStory call reads "the current last keyframe" as its chain anchor.
 * The sequential order IS the keyframe-chain correctness guarantee (do not
 * parallelize this loop).
 *
 * Abort handling (reliability fix): an abort from ONE scene must never brick
 * the batch. `runSingleSceneExtension` returns `aborted` when either the
 * project OR just that scene vanished mid-flight (`scene.service.remove()`
 * has no status guard, so a user CAN delete a batch placeholder mid-run) —
 * the two are distinguished here with a project recheck. Project gone ->
 * abort the whole run (every scene cascaded away with it; nothing to
 * finalize). Only the scene gone -> skip it and continue with the next
 * sceneId. Either way the batch always reaches the single `finalizeProject`
 * below — without it the project would sit in `generating` forever, and
 * since `extend` requires `ready`, it would be permanently unextendable.
 */
async function runSceneExtensionMode(
	step: WorkflowStep,
	ctx: {
		userId: string;
		projectId: string;
		sceneIds: string[];
		workflowInstanceId: string;
	},
): Promise<WorkflowResult> {
	const { userId, projectId, sceneIds, workflowInstanceId } = ctx;

	let anyFailed = false;
	for (const sceneId of sceneIds) {
		const result = await runSingleSceneExtension(step, {
			userId,
			projectId,
			sceneId,
			workflowInstanceId,
		});
		if (result.status === "aborted") {
			const project = await step.do(`ext-abort-recheck-${sceneId}`, () =>
				generationService.loadProject(userId, projectId),
			);
			if (!project) {
				// Project deleted mid-batch: scenes cascaded away with it, so
				// there is no status left to resolve — aborting the run quietly
				// mirrors every other mode's project-vanished path.
				return { status: "aborted", reason: "project-not-found" };
			}
			// Only this scene vanished (user deleted the placeholder mid-run):
			// not a generation failure — its row is gone, nothing to mark.
			// Continue so the remaining batch scenes still generate.
			continue;
		}
		if (result.failed) {
			anyFailed = true;
		}
	}

	await step.do("finalize-ext-batch", () =>
		generationService.finalizeProject(userId, projectId),
	);
	return anyFailed ? { status: "done", failed: true } : { status: "done" };
}

// ---------------------------------------------------------------------------
// Mode: scene-retry
// ---------------------------------------------------------------------------

async function runSceneRetryMode(
	step: WorkflowStep,
	ctx: {
		userId: string;
		projectId: string;
		sceneId: string;
		workflowInstanceId: string;
	},
): Promise<WorkflowResult> {
	const { userId, projectId, sceneId, workflowInstanceId } = ctx;

	const project = await step.do("retry-load-project", () =>
		generationService.loadProject(userId, projectId),
	);
	if (!project?.plan) {
		return { status: "aborted", reason: "project-or-plan-not-found" };
	}
	const scene = await step.do("retry-load-scene", () =>
		generationService.loadScene(userId, sceneId),
	);
	if (!scene) {
		return { status: "aborted", reason: "scene-not-found" };
	}

	// Loaded unconditionally (not just on a missing-start-keyframe branch) —
	// the compat normalization below needs the FULL ordered scene list
	// regardless of which anchor(s) this retry actually needs to regenerate.
	const allScenes = await step.do("retry-load-scenes", () =>
		generationService.loadScenes(userId, projectId),
	);
	const orderedScenes = project.draftTimeline
		.map((entry) =>
			allScenes.find((candidate) => candidate.id === entry.sceneId),
		)
		.filter((candidate): candidate is SceneRow => candidate !== undefined);
	const sceneIndex = orderedScenes.findIndex(
		(candidate) => candidate.id === sceneId,
	);

	// Compat (architecture/v2-prompt-craft): this project may have completed
	// its ORIGINAL generation on the pre-upgrade pipeline and never been
	// extended since (extension is the only OTHER path that heals a plan,
	// see generation.service.ts's runExtensionPlanStep) — see
	// lib/plan-compat.ts's doc comment for what gets defaulted.
	const normalizedPlan = normalizeProjectPlan(
		project.plan,
		orderedScenes.map((row) => ({ id: row.id, prompt: row.prompt })),
	);

	const sceneMeta = normalizedPlan.scenes.find(
		(meta) => meta.sceneId === sceneId,
	);
	if (!sceneMeta || sceneIndex < 0) {
		await step.do("mark-scene-failed-retry-no-meta", () =>
			generationService.markSceneFailed(
				userId,
				sceneId,
				"Scene metadata missing from plan.",
			),
		);
		// GEN-5: this terminal branch used to return without finalizing —
		// every OTHER terminal ("done") branch below calls finalizeProject,
		// and skipping it here left the project stuck in `generating` forever
		// whenever a retry hit this (rare, plan-corruption) path.
		await step.do("finalize-retry-no-meta", () =>
			generationService.finalizeProject(userId, projectId),
		);
		return { status: "done", failed: true };
	}
	const styleBible = normalizeStyleBible(project.styleBible);
	const aspectRatio = project.aspectRatio;

	// Re-run just this scene's sub-chain from its anchors (docs §2): the
	// scene at position `sceneIndex` (0-indexed) starts on keyframe
	// `sceneIndex` and ends on keyframe `sceneIndex + 1` (0-indexed into the
	// K1..KN+1 chain) — reuse existing READY keyframes; regenerate only a
	// missing/failed one, independently for each side, each from its OWN
	// chain entry (architecture/v2-prompt-craft upgrade over the pre-v2
	// "same scenePrompt content for both anchors" simplification). Video +
	// speech always regenerate on retry.
	let startKeyframeAssetId = scene.startKeyframeAssetId;
	let endKeyframeAssetId = scene.endKeyframeAssetId;
	let retryKeyframeFailCode: string | undefined;

	if (!startKeyframeAssetId) {
		const previousScene =
			sceneIndex > 0 ? orderedScenes[sceneIndex - 1] : undefined;
		// GEN-1: the K1..KN+1 chain means this scene's start keyframe and the
		// previous scene's end keyframe are the SAME conceptual asset —
		// `runSingleSceneExtension` already reuses it this way for a brand
		// new scene; a retry must mirror that instead of regenerating (a
		// visible jump cut against an independently-retried neighbor, plus a
		// wasted, billed createTask call — docs finding 1).
		const reusableAssetId = resolveReusableKeyframeAsset({
			attach: "start",
			previousSceneEndKeyframeAssetId: previousScene?.endKeyframeAssetId,
		});
		if (reusableAssetId) {
			await step.do(`reuse-start-keyframe-${sceneId}`, () =>
				generationService.attachStartKeyframe(userId, sceneId, reusableAssetId),
			);
			startKeyframeAssetId = reusableAssetId;
		} else {
			const startKeyframeEntry = normalizedPlan.keyframes[sceneIndex];
			if (startKeyframeEntry) {
				const result = await generateAndAttachKeyframe(step, {
					userId,
					projectId,
					workflowInstanceId,
					sceneId,
					plan: normalizedPlan,
					keyframe: startKeyframeEntry,
					styleBible,
					aspectRatio,
					// The first scene has no predecessor — a null ref here is
					// expected, not an error (K1 never had one either).
					previousKeyframeAssetId: previousScene?.endKeyframeAssetId ?? null,
					attach: "start",
				});
				startKeyframeAssetId = result.assetId;
				retryKeyframeFailCode = result.failCode ?? retryKeyframeFailCode;
			}
		}
	}

	if (!endKeyframeAssetId) {
		const nextScene =
			sceneIndex + 1 < orderedScenes.length
				? orderedScenes[sceneIndex + 1]
				: undefined;
		// GEN-1 (end-anchor side): mirrors the start-anchor reuse above — the
		// next scene's start keyframe is this scene's end keyframe.
		const reusableAssetId = resolveReusableKeyframeAsset({
			attach: "end",
			nextSceneStartKeyframeAssetId: nextScene?.startKeyframeAssetId,
		});
		if (reusableAssetId) {
			await step.do(`reuse-end-keyframe-${sceneId}`, () =>
				generationService.attachEndKeyframe(userId, sceneId, reusableAssetId),
			);
			endKeyframeAssetId = reusableAssetId;
		} else {
			const endKeyframeEntry = normalizedPlan.keyframes[sceneIndex + 1];
			if (endKeyframeEntry) {
				const result = await generateAndAttachKeyframe(step, {
					userId,
					projectId,
					workflowInstanceId,
					sceneId,
					plan: normalizedPlan,
					keyframe: endKeyframeEntry,
					styleBible,
					aspectRatio,
					previousKeyframeAssetId: startKeyframeAssetId,
					attach: "end",
				});
				endKeyframeAssetId = result.assetId;
				retryKeyframeFailCode = result.failCode ?? retryKeyframeFailCode;
			}
		}
	}

	if (!startKeyframeAssetId || !endKeyframeAssetId) {
		await step.do("mark-scene-failed-retry-kf", () =>
			generationService.markSceneFailed(
				userId,
				sceneId,
				generationService.formatFailReason(
					"Keyframe generation failed on retry.",
					retryKeyframeFailCode,
				),
			),
		);
		await step.do("finalize-retry", () =>
			generationService.finalizeProject(userId, projectId),
		);
		return { status: "done", failed: true };
	}

	const freshScene = await step.do("retry-reload-scene", () =>
		generationService.loadScene(userId, sceneId),
	);
	if (!freshScene) {
		return { status: "aborted", reason: "scene-not-found" };
	}

	await generateSceneSpeechAndVideo(step, {
		userId,
		projectId,
		workflowInstanceId,
		scene: freshScene,
		styleBible,
		cinematography: sceneMeta.cinematography,
		aspectRatio,
		audioLanguage: project.audioLanguage,
		characters: normalizedPlan.characters,
	});

	await step.do("finalize-retry", () =>
		generationService.finalizeProject(userId, projectId),
	);
	return { status: "done" };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

/**
 * Orchestrates one generation run (docs §4, §9, phase 3b-2). A single class
 * branches by `mode` rather than three separate WorkflowEntrypoints, since
 * project-generation / scene-extension / scene-retry share almost every
 * step (keyframe/video/speech generation + R2 ingestion) and only differ in
 * what feeds the plan step and which scenes get touched.
 *
 * Must stay a NAMED export re-exported from src/index.ts: the
 * VIDEO_GENERATION_WORKFLOW binding resolves the class by `className` off
 * the worker's compiled script, not via a module path.
 */
export class VideoGenerationWorkflow extends WorkflowEntrypoint<
	Env,
	VideoGenerationWorkflowParams
> {
	async run(
		event: WorkflowEvent<VideoGenerationWorkflowParams>,
		step: WorkflowStep,
	): Promise<WorkflowResult> {
		const { projectId, userId, mode, sceneId } = event.payload;
		const workflowInstanceId = event.instanceId;
		// Back-compat normalization (docs scenes-architecture-v3.md A4): older
		// callers/instances only ever set the singular `sceneId` — treat that
		// as a one-element batch when `sceneIds` isn't present.
		const sceneIds = event.payload.sceneIds ?? (sceneId ? [sceneId] : []);

		try {
			if (mode === WorkflowMode.PROJECT_GENERATION) {
				return await runProjectGenerationMode(step, {
					userId,
					projectId,
					workflowInstanceId,
				});
			}

			if (mode === WorkflowMode.SCENE_EXTENSION) {
				if (sceneIds.length === 0) {
					throw new NonRetryableError(
						`mode "${mode}" requires at least one sceneId`,
					);
				}
				return await runSceneExtensionMode(step, {
					userId,
					projectId,
					sceneIds,
					workflowInstanceId,
				});
			}

			// scene-retry always targets exactly one scene (docs A4's batching
			// is scoped to scene-extension only).
			if (!sceneId) {
				throw new NonRetryableError(`mode "${mode}" requires a sceneId`);
			}
			return await runSceneRetryMode(step, {
				userId,
				projectId,
				sceneId,
				workflowInstanceId,
			});
		} catch (error) {
			// Last-resort safety net: every step that can fail is already
			// caught and translated into a scene-scoped/project-scoped failure
			// internally (docs §5c.1) — this only fires for something that
			// escaped all of that (e.g. the plan step's own agent call
			// exhausting step.do's default retries, or a genuinely
			// unanticipated bug). Project status must ALWAYS be resolvable
			// (docs §5c.2) — never left hanging in `planning`/`generating`
			// forever — so this marks it (or the target scene) failed before
			// re-throwing, which still surfaces the error to the Workflow's
			// own dashboard/observability as an errored instance.
			//
			// Fix-pass W4: the RAW error message is logged (server-side only,
			// via console.error — the Workflow's own dashboard/observability)
			// but NEVER persisted verbatim to fail_reason. An unanticipated
			// bug's message can leak internals (stack-adjacent detail, a raw
			// driver/library error, etc.) that a scoped, already-caught
			// failure's static messages never would — the user-facing
			// fail_reason stays a fixed, safe string for this catch-all path.
			console.error(
				`[VideoGenerationWorkflow] run-level failure (mode=${mode}, project=${projectId}${sceneIds.length > 0 ? `, scenes=${sceneIds.join(",")}` : ""})`,
				error,
			);
			const reason = "Generation failed unexpectedly.";
			await step.do("run-level-failure-guard", async () => {
				if (mode === WorkflowMode.PROJECT_GENERATION || sceneIds.length === 0) {
					await generationService.markProjectFailed(userId, projectId, reason);
				} else {
					for (const id of sceneIds) {
						await generationService.markSceneFailed(userId, id, reason);
					}
					await generationService.finalizeProject(userId, projectId);
				}
			});
			throw error;
		}
	}
}
