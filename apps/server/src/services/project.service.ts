import { ORPCError } from "@orpc/server";
import type {
	CreateProjectInput,
	DeleteProjectInput,
	ExtendProjectInput,
	GetProjectInput,
	ListProjectsInput,
	ProjectDetail,
	Project as ProjectDto,
	ProjectSummary,
	ProjectsPageInput,
	RetryProjectInput,
	Scene as SceneDto,
	UpdateDraftTimelineInput,
	UpdateLanguagesInput,
	UpdateSubtitleStyleInput,
} from "@video-platform-challenge/api";
import {
	invalidTimelineError,
	rateLimitedError,
} from "@video-platform-challenge/api";
import { db, withUser } from "@video-platform-challenge/db";
import { env } from "@video-platform-challenge/env/server";
import {
	createSignedDownloadUrl,
	deleteObjectsByPrefix,
} from "@video-platform-challenge/storage";
import {
	calculatePaginationMeta,
	GENERATION_ABANDON_MINUTES,
	INITIAL_SCENE_COUNT,
	MAX_GENERATION_KICKS_PER_HOUR,
	MAX_PROJECTS_PER_HOUR,
	MIN_SCENE_DURATION_SECONDS,
	ProjectStatus,
	SceneStatus,
	TemplateKey,
	type TimelineEntry,
} from "@video-platform-challenge/types";
import { sql } from "drizzle-orm";

import type { Context } from "../lib/context";
import { isProjectReclaimable } from "../lib/project-reclaim";
import { findTimelineCompletenessViolations } from "../lib/timeline";
import * as assetRepository from "../repositories/asset.repository";
import * as generationTaskRepository from "../repositories/generation-task.repository";
import type { ProjectRow } from "../repositories/project.repository";
import * as projectRepository from "../repositories/project.repository";
import type { NewSceneRow } from "../repositories/scene.repository";
import * as sceneRepository from "../repositories/scene.repository";
import * as versionRepository from "../repositories/version.repository";
import { toAssetDto } from "./asset.service";
import * as generationService from "./generation.service";
import { toSceneDto } from "./scene.service";
import { toVersionDto } from "./version.service";

const ONE_HOUR_MS = 60 * 60 * 1000;

function rateLimited(): never {
	throw new ORPCError("RATE_LIMITED", {
		status: rateLimitedError.status,
		message: rateLimitedError.message,
	});
}

type SessionUser = NonNullable<Context["session"]>;

export function toProjectDto(row: ProjectRow): ProjectDto {
	return {
		id: row.id,
		templateKey: row.templateKey,
		description: row.description,
		title: row.title,
		synopsis: row.synopsis,
		status: row.status,
		aspectRatio: row.aspectRatio,
		audioLanguage: row.audioLanguage,
		subtitleLanguage: row.subtitleLanguage,
		styleBible: row.styleBible ?? null,
		subtitleStyle: row.subtitleStyle ?? null,
		draftTimeline: row.draftTimeline,
		failReason: row.failReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// Real per-scene prompts are agent-authored by the plan/extendStory step
// (docs §7, phase 3b-2). Until that lands, this keeps `scenes.prompt` (NOT
// NULL) populated with something traceable back to the user's own ask
// instead of an opaque placeholder.
function placeholderScenePrompt(description: string, index: number): string {
	return `Scene ${index + 1} placeholder — plan pending. Project premise: ${description}`;
}

/**
 * Persists the project row, its INITIAL_SCENE_COUNT placeholder scenes, and
 * the initial draft timeline in one transaction, then kicks generation
 * (currently the phase-3b-2 stub). Timeline entries are seeded with
 * `videoAssetId: ""` — no scene has a video yet at creation time; phase
 * 3b-2's generation pipeline is what assigns real asset ids per entry (see
 * this phase's deviations note).
 */
type CreateOptions = { session: SessionUser } & CreateProjectInput;

export async function create({
	session,
	description,
	templateKey,
	aspectRatio,
	audioLanguage,
	subtitleLanguage,
}: CreateOptions): Promise<ProjectSummary> {
	const userId = session.user.id;

	const project = await withUser(db, userId, async (tx) => {
		// WARNING fix (TOCTOU): unlike extend/retry, `create` has no existing
		// project row to lock with `findByIdForUpdate` — a concurrent burst of
		// create calls for the SAME user could otherwise all read the same
		// sub-limit `recentCount` and all pass the guard below, each kicking
		// real kie.ai spend. `pg_advisory_xact_lock` is transaction-scoped
		// (auto-released on commit/rollback, same lifetime as this `withUser`
		// transaction) and keyed by `hashtext(userId)` — a bound parameter via
		// drizzle's `sql` tag, NEVER string-interpolated, so this can't be
		// abused for injection. Different users lock independently; this never
		// serializes across users, only serializes one user's own concurrent
		// creates so the count-then-insert below becomes atomic in practice.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

		const recentCount = await projectRepository.countCreatedSince(
			tx,
			userId,
			new Date(Date.now() - ONE_HOUR_MS),
		);
		if (recentCount >= MAX_PROJECTS_PER_HOUR) {
			rateLimited();
		}

		const projectRow = await projectRepository.insertProject(tx, {
			userId,
			// No "sports-anime" generic template value exists in
			// packages/types' TemplateKey (soccer | basketball | baseball |
			// tennis) — soccer is the doc's own worked example (Messi/penalty,
			// docs §1), so it's the MVP default when the caller omits one.
			templateKey: templateKey ?? TemplateKey.SOCCER,
			description,
			status: ProjectStatus.DRAFT,
			aspectRatio,
			audioLanguage,
			subtitleLanguage,
			draftTimeline: [],
		});

		const sceneValues: NewSceneRow[] = Array.from(
			{ length: INITIAL_SCENE_COUNT },
			(_, index) => ({
				projectId: projectRow.id,
				userId,
				prompt: placeholderScenePrompt(description, index),
				status: SceneStatus.PLANNED,
				durationSeconds: MIN_SCENE_DURATION_SECONDS,
			}),
		);
		const sceneRows = await sceneRepository.insertMany(tx, sceneValues);

		const timeline: TimelineEntry[] = sceneRows.map((scene) => ({
			sceneId: scene.id,
			videoAssetId: "",
			durationSeconds: scene.durationSeconds,
		}));

		const updatedProject = await projectRepository.updateDraftTimeline(
			tx,
			userId,
			projectRow.id,
			timeline,
		);
		if (!updatedProject) {
			throw new Error("Failed to persist initial draft timeline");
		}

		return updatedProject;
	});

	await generationService.startProjectGeneration(project.id, userId);

	return {
		id: project.id,
		title: project.title,
		status: project.status,
		templateKey: project.templateKey,
		aspectRatio: project.aspectRatio,
		createdAt: project.createdAt,
		thumbnailAssetId: null,
		thumbnailKind: null,
		thumbnailUrl: null,
	};
}

/** Lists the caller's own projects, newest first (limit/offset). */
type ListOptions = { session: SessionUser } & ListProjectsInput;

export async function list({
	session,
	limit,
	offset,
}: ListOptions): Promise<ProjectSummary[]> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const rows = await projectRepository.findManyByUser(tx, userId, {
			limit,
			offset,
		});
		const thumbnails = await assetRepository.findThumbnailsByProjectIds(
			tx,
			userId,
			rows.map((row) => row.id),
		);

		// Signing is local HMAC (no network) — cheap to do per row; Promise.all
		// keeps the map body's `await` from serializing across rows. The signed
		// GET URL travels WITH the summary so the card renders with zero extra
		// round-trips. R2 keys never leave the server, only the short-lived URL.
		return Promise.all(
			rows.map(async (row) => {
				const preview = thumbnails.get(row.id);
				return {
					id: row.id,
					title: row.title,
					status: row.status,
					templateKey: row.templateKey,
					aspectRatio: row.aspectRatio,
					createdAt: row.createdAt,
					thumbnailAssetId: preview?.id ?? null,
					thumbnailKind: preview?.kind ?? null,
					thumbnailUrl: preview?.r2Key
						? (await createSignedDownloadUrl({ key: preview.r2Key })).url
						: null,
				};
			}),
		);
	});
}

/**
 * Full project detail: row + scenes + assets + versions, assembled from a
 * few indexed queries inside one withUser transaction — no N+1 loops.
 */
type GetOptions = { session: SessionUser } & GetProjectInput;

export async function get({ session, id }: GetOptions): Promise<ProjectDetail> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, id);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const [sceneRows, assetRows, versionRows] = await Promise.all([
			sceneRepository.findManyByProjectId(tx, userId, id),
			assetRepository.findManyByProjectId(tx, userId, id),
			versionRepository.findManyByProjectId(tx, userId, id),
		]);

		return {
			...toProjectDto(project),
			scenes: sceneRows.map(toSceneDto),
			assets: assetRows.map(toAssetDto),
			versions: versionRows.map(toVersionDto),
		};
	});
}

/**
 * Persists the draft timeline — THE only scene-ordering authority (docs §6,
 * §9). The submitted entry sceneId SET must equal EXACTLY the project's
 * current scene ids (no missing, no extra/foreign, no duplicates), else
 * INVALID_TIMELINE with the offending ids (fix-pass B1 — zod can't check
 * this, it's a database existence/completeness check). The client only
 * controls ORDER: videoAssetId/durationSeconds are always re-derived
 * server-side from the scene rows, never trusted from the request body —
 * a stale/forged client value (e.g. an old videoAssetId re-submitted after
 * a regeneration) can never leak into the authoritative timeline this way.
 * Runs under `SELECT ... FOR UPDATE` on the project row (B1) so this can
 * never race another concurrent draft_timeline writer (extend, scene
 * remove/update, the generation pipeline's timeline backfill).
 */
type UpdateDraftTimelineOptions = {
	session: SessionUser;
} & UpdateDraftTimelineInput;

export async function updateDraftTimeline({
	session,
	id,
	timeline,
}: UpdateDraftTimelineOptions): Promise<ProjectDto> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const project = await projectRepository.findByIdForUpdate(tx, userId, id);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const sceneRows = await sceneRepository.findManyByProjectId(tx, userId, id);
		const sceneById = new Map(sceneRows.map((scene) => [scene.id, scene]));
		const validSceneIds = new Set(sceneById.keys());

		const invalidSceneIds = findTimelineCompletenessViolations(
			validSceneIds,
			timeline.map((entry) => entry.sceneId),
		);

		if (invalidSceneIds.size > 0) {
			// INVALID_TIMELINE isn't a common oRPC error code, so it gets no
			// automatic HTTP status fallback (unlike NOT_FOUND/CONFLICT, which
			// happen to match their common-code defaults) — status/message are
			// pulled from the contract's own error definition so this can never
			// drift from what packages/api declares.
			throw new ORPCError("INVALID_TIMELINE", {
				status: invalidTimelineError.status,
				message: invalidTimelineError.message,
				data: { invalidSceneIds: [...invalidSceneIds] },
			});
		}

		const derivedTimeline: TimelineEntry[] = timeline.map((entry) => {
			// Every entry.sceneId is guaranteed present in sceneById —
			// findTimelineCompletenessViolations already proved the submitted id
			// set exactly equals validSceneIds.
			// biome-ignore lint/style/noNonNullAssertion: proven present above
			const scene = sceneById.get(entry.sceneId)!;
			return {
				sceneId: scene.id,
				videoAssetId: scene.videoAssetId ?? "",
				durationSeconds: scene.durationSeconds,
			};
		});

		const updated = await projectRepository.updateDraftTimeline(
			tx,
			userId,
			id,
			derivedTimeline,
		);
		if (!updated) {
			throw new ORPCError("NOT_FOUND");
		}
		return toProjectDto(updated);
	});
}

/** Updates the project's subtitle style object (docs §5b). */
type UpdateSubtitleStyleOptions = {
	session: SessionUser;
} & UpdateSubtitleStyleInput;

export async function updateSubtitleStyle({
	session,
	id,
	subtitleStyle,
}: UpdateSubtitleStyleOptions): Promise<ProjectDto> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const updated = await projectRepository.updateSubtitleStyle(
			tx,
			userId,
			id,
			subtitleStyle,
		);
		if (!updated) {
			throw new ORPCError("NOT_FOUND");
		}
		return toProjectDto(updated);
	});
}

/** Updates audio/subtitle language selection — independent of each other. */
type UpdateLanguagesOptions = { session: SessionUser } & UpdateLanguagesInput;

export async function updateLanguages({
	session,
	id,
	audioLanguage,
	subtitleLanguage,
}: UpdateLanguagesOptions): Promise<ProjectDto> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const updated = await projectRepository.updateLanguages(tx, userId, id, {
			audioLanguage,
			subtitleLanguage,
		});
		if (!updated) {
			throw new ORPCError("NOT_FOUND");
		}
		return toProjectDto(updated);
	});
}

/**
 * Extends the story by `sceneCount` scenes (docs scenes-architecture-v3.md
 * A4 batching, default 1), appended to the draft timeline in order. Only
 * allowed while the project is `ready` (not generating/rendering, per the
 * doc's core loop) — else CONFLICT. Reads the project under
 * `SELECT ... FOR UPDATE` (fix-pass B1) and flips its status to `generating`
 * inside the SAME transaction as the status guard check — this closes the
 * race where two concurrent `extend` calls both read `ready` before either
 * writes, and doubles as the one-active-workflow-per-project enforcement
 * (a project can never have two extend/generation runs in flight, since the
 * second call's guard now sees `generating`, not `ready`).
 * ALL `sceneCount` placeholders are handed to ONE workflow instance
 * (`generationService.startSceneExtension`, docs A4 "one workflow per
 * batch") — never one workflow per scene, which would let two batches race
 * and fork the keyframe chain. `runSceneExtensionMode`'s batch `finalize`
 * step (workflows/video-generation.ts) is what returns the project to
 * `ready`/`failed` once the workflow completes; if the workflow itself never
 * starts (see generationService.startSceneExtension's catch branch), that
 * same finalize logic is invoked directly so the project is never left stuck
 * in `generating` forever.
 * Returns only the FIRST scene of the batch — the contract's `SceneDto`
 * output stays singular (out of this phase's scope to change), and the
 * caller (`useExtendProject`) only uses the response to trigger a
 * `projects.get` refetch, not to render this value directly.
 */
type ExtendOptions = { session: SessionUser } & ExtendProjectInput;

export async function extend({
	session,
	id,
	prompt,
	sceneCount,
}: ExtendOptions): Promise<SceneDto> {
	const userId = session.user.id;

	const sceneRows = await withUser(db, userId, async (tx) => {
		const project = await projectRepository.findByIdForUpdate(tx, userId, id);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}
		// MAJOR fix (wedged projects never reclaim): a project stuck
		// non-terminal past GENERATION_ABANDON_MINUTES (e.g. the isolate
		// running its workflow was killed before the run-level catch-all ever
		// marked it failed) is treated as reclaimable — the same time-based
		// recovery version.service.ts::render already has via
		// RENDER_ABANDON_MINUTES. Without this, the terminal-status guard
		// below was a permanent dead end for a wedged project.
		if (
			!isProjectReclaimable({
				status: project.status,
				terminalStatuses: [ProjectStatus.READY],
				updatedAt: project.updatedAt,
				now: new Date(),
				abandonMinutes: GENERATION_ABANDON_MINUTES,
			})
		) {
			throw new ORPCError("CONFLICT");
		}

		const recentKicks = await generationTaskRepository.countSince(
			tx,
			userId,
			new Date(Date.now() - ONE_HOUR_MS),
		);
		if (recentKicks >= MAX_GENERATION_KICKS_PER_HOUR) {
			rateLimited();
		}

		const sceneValues: NewSceneRow[] = Array.from(
			{ length: sceneCount },
			(_, index) => ({
				projectId: project.id,
				userId,
				prompt:
					prompt ??
					placeholderScenePrompt(
						project.description,
						project.draftTimeline.length + index,
					),
				status: SceneStatus.PLANNED,
				durationSeconds: MIN_SCENE_DURATION_SECONDS,
			}),
		);
		const insertedScenes = await sceneRepository.insertMany(tx, sceneValues);

		const timeline: TimelineEntry[] = [
			...project.draftTimeline,
			...insertedScenes.map((sceneRow) => ({
				sceneId: sceneRow.id,
				videoAssetId: "",
				durationSeconds: sceneRow.durationSeconds,
			})),
		];

		const updatedProject = await projectRepository.updateById(
			tx,
			userId,
			project.id,
			{
				status: ProjectStatus.GENERATING,
				draftTimeline: timeline,
			},
		);
		if (!updatedProject) {
			throw new Error("Failed to persist extended draft timeline");
		}

		return insertedScenes;
	});

	const [firstScene] = sceneRows;
	if (!firstScene) {
		// Unreachable in practice — extendProjectInputSchema bounds sceneCount
		// to MIN_SCENES_PER_GENERATION..MAX (>= 1), so insertMany above always
		// returns at least one row. Guarded defensively rather than asserted.
		throw new Error("Failed to insert extension scene rows");
	}

	await generationService.startSceneExtension(
		id,
		sceneRows.map((sceneRow) => sceneRow.id),
		userId,
	);
	return toSceneDto(firstScene);
}

/**
 * Re-runs a failed/stuck project's generation from where it left off. The
 * resume-aware workflow (`runProjectGenerationMode`) reuses the existing plan
 * and skips already-`ready` sheets/keyframes/videos, regenerating only what's
 * missing. Guarded exactly like `extend`/scene retry: reads the project under
 * `SELECT ... FOR UPDATE`, allows retry only when it's terminal (READY/FAILED)
 * or wedged non-terminal past GENERATION_ABANDON_MINUTES (its workflow died),
 * enforces the hourly kick rate limit, then flips the status to `generating`
 * inside the same guarded transaction so a concurrent retry/extend CONFLICTs.
 * The workflow is kicked AFTER the transaction commits.
 */
type RetryOptions = { session: SessionUser } & RetryProjectInput;

export async function retry({
	session,
	id,
}: RetryOptions): Promise<ProjectDto> {
	const userId = session.user.id;

	const updated = await withUser(db, userId, async (tx) => {
		const project = await projectRepository.findByIdForUpdate(tx, userId, id);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}
		// Same terminal/reclaimable guard as `extend`/scene retry: a READY or
		// FAILED project may retry, or one wedged non-terminal past the abandon
		// window (its workflow died). A live generating run is CONFLICT.
		if (
			!isProjectReclaimable({
				status: project.status,
				terminalStatuses: [ProjectStatus.READY, ProjectStatus.FAILED],
				updatedAt: project.updatedAt,
				now: new Date(),
				abandonMinutes: GENERATION_ABANDON_MINUTES,
			})
		) {
			throw new ORPCError("CONFLICT");
		}

		const recentKicks = await generationTaskRepository.countSince(
			tx,
			userId,
			new Date(Date.now() - ONE_HOUR_MS),
		);
		if (recentKicks >= MAX_GENERATION_KICKS_PER_HOUR) {
			rateLimited();
		}

		// Flip to `generating` inside the guarded tx so a concurrent retry/extend
		// sees it and CONFLICTs (same race-closing move as `extend`). The
		// resume-aware workflow reuses the existing plan + skips done assets.
		const flipped = await projectRepository.updateById(tx, userId, id, {
			status: ProjectStatus.GENERATING,
		});
		if (!flipped) {
			throw new Error("Failed to flip project to generating for retry");
		}
		return flipped;
	});

	await generationService.startProjectGeneration(id, userId);
	return toProjectDto(updated);
}

/**
 * Deletes a project and everything under it — FK cascade handles children.
 * Fix-pass W7 (delete mid-flight): best-effort terminates every in-flight
 * generation workflow instance for this project. Without this, a workflow
 * already running against this project keeps polling/retrying kie.ai for
 * rows nobody can see anymore (W7a's ingest-side project-existence guards
 * make that harmless to data integrity, but not to spend/noise). The
 * still-`pending` workflow instance ids are read INSIDE the same transaction
 * as the delete, before it runs (the delete cascades generation_tasks away);
 * termination itself is an RPC to the Workflows binding, done AFTER the
 * transaction commits — the same "no external I/O inside an open DB tx"
 * rule the rest of this pipeline follows (see fetchAndPutToR2's doc
 * comment). Termination failures are swallowed per instance: the instance
 * may have already completed, errored, or been terminated already.
 *
 * R2 cleanup: after the DB row is gone, every object this project ever wrote
 * lives under `users/{userId}/projects/{projectId}/` (see lib/r2-keys.ts
 * buildAssetR2Key) — `deleteObjectsByPrefix` purges the whole prefix so no
 * orphaned objects are left behind. Best-effort and OUTSIDE any transaction:
 * the DB delete has already committed, so a storage failure must not fail the
 * whole operation (that would surface an error for a project the user can no
 * longer see); it's logged and swallowed instead.
 */
type DeleteOptions = { session: SessionUser } & DeleteProjectInput;

export async function deleteProject({
	session,
	id,
}: DeleteOptions): Promise<void> {
	const userId = session.user.id;

	const pendingInstanceIds = await withUser(db, userId, async (tx) => {
		const instanceIds =
			await generationTaskRepository.findDistinctPendingWorkflowInstanceIds(
				tx,
				userId,
				id,
			);
		const deleted = await projectRepository.deleteById(tx, userId, id);
		if (!deleted) {
			throw new ORPCError("NOT_FOUND");
		}
		return instanceIds;
	});

	await Promise.all(
		pendingInstanceIds.map(async (instanceId) => {
			try {
				const instance = await env.VIDEO_GENERATION_WORKFLOW.get(instanceId);
				await instance.terminate();
			} catch (error) {
				console.warn(
					`[project.service] failed to terminate workflow instance ${instanceId} for deleted project ${id}`,
					error,
				);
			}
		}),
	);

	try {
		await deleteObjectsByPrefix(`users/${userId}/projects/${id}/`);
	} catch (error) {
		console.error(
			`[project.service] failed to purge R2 objects for deleted project ${id}`,
			error,
		);
	}
}

/**
 * Paginated cards for the /projects page — shared `{ items, meta }` envelope
 * (packages/types pagination contract).
 */
export async function page({
	session,
	...query
}: { session: SessionUser } & ProjectsPageInput) {
	return withUser(db, session.user.id, async (tx) => {
		const { items, total } = await projectRepository.pageProjects(
			tx,
			session.user.id,
			query,
		);
		// Sign each item's `previewUrl` from the repo-internal `previewR2Key`,
		// then DROP `previewR2Key` so the returned shape matches
		// `projectPageItemSchema` exactly — R2 keys never reach the client, only
		// short-lived signed URLs.
		const signedItems = await Promise.all(
			items.map(async ({ previewR2Key, ...item }) => ({
				...item,
				previewUrl: previewR2Key
					? (await createSignedDownloadUrl({ key: previewR2Key })).url
					: null,
			})),
		);
		return {
			items: signedItems,
			meta: calculatePaginationMeta(total, query.page, query.pageSize),
		};
	});
}
