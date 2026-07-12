// Pure predicates + copy for the first-version glass overlay (RT-2, docs
// realtime-and-render-lock-v1.md §2). Kept side-effect-free so
// `first-run-overlay.tsx` and `studio-view.tsx` share the exact same
// derivation instead of two components quietly drifting apart.
import type { Project, Scene } from "@video-platform-challenge/api";
import { ProjectStatus, SceneStatus } from "@video-platform-challenge/types";

import { isProjectActive } from "@/feature/studio/hooks/http/use-project";

function hasReadyScene(scenes: readonly Scene[]): boolean {
	return scenes.some((scene) => scene.status === SceneStatus.VIDEO_READY);
}

/**
 * True while a project's FIRST-EVER generation is in flight: the project
 * hasn't settled to a terminal status yet, and no scene has reached
 * `video_ready`. `extend` only ever runs on an already-`ready` project
 * (which by definition already has ≥1 `video_ready` scene), so this is
 * exclusively true during the first run and lifts the instant the first
 * scene lands or the project reaches a terminal status — never re-triggers
 * for a later extend/retry.
 */
export function isFirstGeneration(
	project: Project,
	scenes: readonly Scene[],
): boolean {
	return isProjectActive(project) && !hasReadyScene(scenes);
}

/**
 * True when the project's first-ever generation ended in `failed` before
 * any scene ever reached `video_ready`. Distinct from a later extend/retry
 * failure (which always has ≥1 `video_ready` scene already, since extend
 * only runs on a `ready` project) — this is the overlay's error/Retry state,
 * not a general "project failed" flag.
 */
export function isFirstGenerationFailure(
	project: Project,
	scenes: readonly Scene[],
): boolean {
	return project.status === ProjectStatus.FAILED && !hasReadyScene(scenes);
}

/**
 * Live status copy for the overlay (docs §2: "Planning the story…",
 * "Generating keyframes…", "Generating scene N…"). Only ever called while
 * `isFirstGeneration` is true, so `project.status` is always one of
 * draft/planning/storyboard/generating/assembling — never ready/failed.
 */
export function describeFirstRunStatus(
	project: Project,
	scenes: readonly Scene[],
): string {
	if (
		project.status === ProjectStatus.DRAFT ||
		project.status === ProjectStatus.PLANNING ||
		project.status === ProjectStatus.STORYBOARD
	) {
		return "Planning the story…";
	}

	const total = scenes.length;
	const activeIndex = scenes.findIndex(
		(scene) =>
			scene.status === SceneStatus.KEYFRAME_PENDING ||
			scene.status === SceneStatus.KEYFRAME_READY ||
			scene.status === SceneStatus.VIDEO_PENDING,
	);

	if (total === 0 || activeIndex === -1) {
		return "Generating keyframes…";
	}

	return scenes[activeIndex]?.status === SceneStatus.VIDEO_PENDING
		? `Generating scene ${activeIndex + 1} of ${total}…`
		: "Generating keyframes…";
}
