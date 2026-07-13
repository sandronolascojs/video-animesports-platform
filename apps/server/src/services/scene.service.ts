import { ORPCError } from "@orpc/server";
import type {
	RemoveSceneInput,
	RemoveSceneOutput,
	RetrySceneInput,
	Scene as SceneDto,
	UpdateSceneInput,
} from "@video-platform-challenge/api";
import { rateLimitedError } from "@video-platform-challenge/api";
import { db, withUser } from "@video-platform-challenge/db";
import type { TimelineEntry } from "@video-platform-challenge/types";
import {
	GENERATION_ABANDON_MINUTES,
	MAX_GENERATION_KICKS_PER_HOUR,
	ProjectStatus,
	SceneStatus,
} from "@video-platform-challenge/types";

import type { Context } from "../lib/context";
import { isProjectReclaimable } from "../lib/project-reclaim";
import {
	isLockedSceneFieldEdit,
	STALE_DIALOGUE_GUARD_MESSAGE,
} from "../lib/scene-update-guard";
import * as generationTaskRepository from "../repositories/generation-task.repository";
import * as projectRepository from "../repositories/project.repository";
import type { SceneRow } from "../repositories/scene.repository";
import * as sceneRepository from "../repositories/scene.repository";
import * as generationService from "./generation.service";

const ONE_HOUR_MS = 60 * 60 * 1000;

type SessionUser = NonNullable<Context["session"]>;

export function toSceneDto(row: SceneRow): SceneDto {
	return {
		id: row.id,
		projectId: row.projectId,
		title: row.title,
		prompt: row.prompt,
		dialogue: row.dialogue,
		speakerName: row.speakerName,
		subtitleText: row.subtitleText,
		speechCues: row.speechCues ?? null,
		status: row.status,
		durationSeconds: row.durationSeconds,
		startKeyframeAssetId: row.startKeyframeAssetId,
		endKeyframeAssetId: row.endKeyframeAssetId,
		videoAssetId: row.videoAssetId,
		failReason: row.failReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Edits scene fields. Ownership is resolved by the scene's own denormalized
 * userId (docs §5d.1, §5c.4) — a miss (not found OR foreign-owned) is
 * indistinguishable and always NOT_FOUND (docs §5d.6).
 *
 * Stale dialogue/duration guard (docs §8e): once a scene reaches
 * `video_ready` its clip's audio is already baked in from the CURRENT
 * `dialogue`/`durationSeconds` — editing either afterwards would desync the
 * row from what was actually rendered (`isLockedSceneFieldEdit`,
 * lib/scene-update-guard.ts), so those two fields are rejected with CONFLICT
 * once generation has produced a clip. `subtitleText` stays editable always
 * (captions burn in at export time from the current row, independent of the
 * baked audio).
 *
 * When `durationSeconds` changes, the project's `draft_timeline` entry for
 * this scene goes stale the moment the scene row commits — the timeline is
 * the render-time source of truth for clip length (docs §6, §9), so it must
 * stay in lockstep (fix-pass C2). That sync locks the project row via
 * `findByIdForUpdate` (B1's helper) BEFORE writing the scene, matching the
 * lock-project-before-any-scene-write ordering every other draft_timeline
 * writer uses (extend/updateDraftTimeline/remove/the generation pipeline's
 * timeline backfill) — acquiring it in the opposite order here would be a
 * deadlock risk against those call sites.
 */
type UpdateOptions = { session: SessionUser } & UpdateSceneInput;

export async function update({
	session,
	id,
	...patch
}: UpdateOptions): Promise<SceneDto> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const existing = await sceneRepository.findById(tx, userId, id);
		if (!existing) {
			throw new ORPCError("NOT_FOUND");
		}
		if (isLockedSceneFieldEdit(existing.status, patch)) {
			throw new ORPCError("CONFLICT", {
				message: STALE_DIALOGUE_GUARD_MESSAGE,
			});
		}

		if (patch.durationSeconds === undefined) {
			const row = await sceneRepository.updateById(tx, userId, id, patch);
			if (!row) {
				throw new ORPCError("NOT_FOUND");
			}
			return toSceneDto(row);
		}

		const project = await projectRepository.findByIdForUpdate(
			tx,
			userId,
			existing.projectId,
		);

		const row = await sceneRepository.updateById(tx, userId, id, patch);
		if (!row) {
			throw new ORPCError("NOT_FOUND");
		}

		if (project) {
			const timeline: TimelineEntry[] = project.draftTimeline.map((entry) =>
				entry.sceneId === id
					? { ...entry, durationSeconds: row.durationSeconds }
					: entry,
			);
			await projectRepository.updateDraftTimeline(
				tx,
				userId,
				project.id,
				timeline,
			);
		}

		return toSceneDto(row);
	});
}

/**
 * Re-kicks a failed scene's generation. Only `failed` scenes can be retried
 * (docs §5c.1) — any other status is CONFLICT. Resets the scene back to
 * `planned` (the pre-generation pending state; there is no per-step
 * generations table in this phase to resume from a finer-grained anchor —
 * see the phase report's deviations note).
 *
 * Fix-pass C1: the status check and the reset write happen in ONE atomic
 * `UPDATE ... WHERE status = 'failed'` (`updateByIdWhereStatus`) instead of
 * a separate read-then-write pair — closes the TOCTOU window where two
 * concurrent retries on the same scene could otherwise both pass the read
 * check and both kick a workflow.
 *
 * GEN-6 (docs ai-architecture-v1.md §5 finding 6): also locks the OWNING
 * project row (`findByIdForUpdate`) and requires a TERMINAL status (`ready`
 * or `failed`) — the same project-level guard `project.service.ts::extend`
 * has, and for the same reason: without it, a retry could kick its own
 * workflow instance while an extension batch is already running against
 * this project, racing the keyframe chain (a plausible trigger for finding
 * 1). `failed` is deliberately allowed, unlike extend: retrying a failed
 * project's scene is the recovery path that flips it back to `ready`. A
 * project not currently found (or non-terminal AND not abandoned, see
 * `isProjectReclaimable`) resolves the scene lookup first, so
 * NOT_FOUND/CONFLICT still distinguish correctly.
 *
 * BLOCKER fix: this used to only READ the project's status, never WRITE it —
 * so a retry left the project at `ready`/`failed` for its whole multi-minute
 * workflow, and a concurrent `projects.extend` would pass ITS OWN
 * terminal-status guard and regenerate the same shared boundary keyframe as
 * a different image (a silent jump-cut). Mirrors
 * `project.service.ts::extend` EXACTLY: flips the project to `generating`
 * INSIDE this same guarded transaction, right after the terminal-status
 * check, so a concurrent extend/retry now sees `generating` and CONFLICTs.
 * `runSceneRetryMode`'s `finalize-retry` step (workflows/video-generation.ts)
 * runs on every one of its exit paths and always re-terminalizes the
 * project back to `ready`/`failed` — see `generation.service.ts::retryScene`
 * for the one path that never reaches the workflow (start failure), which
 * now finalizes too for the same reason.
 */
type RetryOptions = { session: SessionUser } & RetrySceneInput;

export async function retry({ session, id }: RetryOptions): Promise<SceneDto> {
	const userId = session.user.id;

	const row = await withUser(db, userId, async (tx) => {
		const existingScene = await sceneRepository.findById(tx, userId, id);
		if (!existingScene) {
			throw new ORPCError("NOT_FOUND");
		}

		const project = await projectRepository.findByIdForUpdate(
			tx,
			userId,
			existingScene.projectId,
		);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}
		// Terminal statuses only: READY and FAILED may retry — a failed
		// project's scene retry is THE recovery path (a successful retry's
		// finalizeProject flips the project back to ready). Non-terminal
		// statuses mean a workflow is running; retrying would race it, UNLESS
		// the project has been wedged non-terminal past
		// GENERATION_ABANDON_MINUTES (isProjectReclaimable) — the same
		// time-based recovery version.service.ts::render has via
		// RENDER_ABANDON_MINUTES.
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
			throw new ORPCError("RATE_LIMITED", {
				status: rateLimitedError.status,
				message: rateLimitedError.message,
			});
		}

		const updated = await sceneRepository.updateByIdWhereStatus(
			tx,
			userId,
			id,
			SceneStatus.FAILED,
			{ status: SceneStatus.PLANNED, failReason: null },
		);
		if (!updated) {
			throw new ORPCError("CONFLICT");
		}

		// BLOCKER fix: see the doc comment above — write GENERATING inside
		// this same transaction so a concurrent extend/retry's own guard
		// observes it.
		await projectRepository.updateById(tx, userId, project.id, {
			status: ProjectStatus.GENERATING,
		});

		return updated;
	});

	await generationService.retryScene(id, userId);
	return toSceneDto(row);
}

/**
 * Removes a scene and returns the corrected draft timeline — a single
 * withUser transaction that both deletes the scene AND persists the
 * timeline with its entry dropped (docs/contract doc-comment).
 */
type RemoveOptions = { session: SessionUser } & RemoveSceneInput;

export async function remove({
	session,
	id,
}: RemoveOptions): Promise<RemoveSceneOutput> {
	return withUser(db, session.user.id, async (tx) => {
		const scene = await sceneRepository.findById(tx, session.user.id, id);
		if (!scene) {
			throw new ORPCError("NOT_FOUND");
		}

		// Fix-pass B1: lock the project row before reading/writing
		// draft_timeline, serializing against every other concurrent writer.
		const project = await projectRepository.findByIdForUpdate(
			tx,
			session.user.id,
			scene.projectId,
		);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const deleted = await sceneRepository.deleteById(tx, session.user.id, id);
		if (!deleted) {
			throw new ORPCError("NOT_FOUND");
		}

		const correctedTimeline: TimelineEntry[] = project.draftTimeline.filter(
			(entry) => entry.sceneId !== id,
		);

		const updatedProject = await projectRepository.updateDraftTimeline(
			tx,
			session.user.id,
			project.id,
			correctedTimeline,
		);
		if (!updatedProject) {
			throw new ORPCError("NOT_FOUND");
		}

		return { timeline: updatedProject.draftTimeline };
	});
}
