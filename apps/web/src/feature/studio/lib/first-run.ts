"use client";

// Pure predicates + copy for a project's first-ever generation (RT-2, docs
// realtime-and-render-lock-v1.md §2). Side-effect-free so the non-blocking
// player generating-state (`player-generating-state.tsx`) and the completion
// toast (`use-first-run-toast.tsx`) share the exact same derivation instead
// of each re-deriving it and quietly drifting apart.
import type { Project, Scene } from "@video-platform-challenge/api";
import { ProjectStatus, SceneStatus } from "@video-platform-challenge/types";

import { isProjectActive } from "@/feature/studio/hooks/http/use-project";

function hasReadyScene(scenes: readonly Scene[]): boolean {
	return scenes.some((scene) => scene.status === SceneStatus.VIDEO_READY);
}

/**
 * True while a project's first-ever generation is still in flight: the
 * project hasn't settled to a terminal status yet AND no scene has ever
 * reached `video_ready`. Pure snapshot predicate — no latch, no history.
 *
 * `extend` only ever starts from an already-`ready` project (which by
 * definition has ≥1 `video_ready` scene), so this is `false` for every
 * extend/retry-of-a-finished-project — it isolates the FIRST generation from
 * any later one. The moment the first scene lands (`video_ready`) this flips
 * `false` even though the project stays active, so the player hands off from
 * the generating-state to the real timeline (ready clips + pending
 * placeholders) exactly when there is finally something to play.
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
 * only runs on a `ready` project) — this is the player's error/Retry state,
 * not a general "project failed" flag. Snapshot-only: this predicate alone
 * is enough to tell a first-run failure apart from any other kind, so it
 * stays correct even across a page reload mid-failure.
 */
export function isFirstGenerationFailure(
	project: Project,
	scenes: readonly Scene[],
): boolean {
	return project.status === ProjectStatus.FAILED && !hasReadyScene(scenes);
}

/**
 * Coarse generation phase behind the player's generating state (issue #3,
 * docs/studio-fixes-backlog.md §3): the SINGLE derivation `describeFirstRunStatus`
 * (copy) and the `GridLoader` pattern (`player-generating-state.tsx`, mark)
 * both key off, so the mark and the label can never drift out of sync with
 * each other or with the real project/scene state.
 */
export type FirstRunPhase = "planning" | "keyframes" | "rendering";

export function getFirstRunPhase(
	project: Project,
	scenes: readonly Scene[],
): FirstRunPhase {
	if (
		project.status === ProjectStatus.DRAFT ||
		project.status === ProjectStatus.PLANNING ||
		project.status === ProjectStatus.STORYBOARD
	) {
		return "planning";
	}

	const activeIndex = scenes.findIndex(
		(scene) =>
			scene.status === SceneStatus.KEYFRAME_PENDING ||
			scene.status === SceneStatus.KEYFRAME_READY ||
			scene.status === SceneStatus.VIDEO_PENDING,
	);

	if (
		activeIndex === -1 ||
		scenes[activeIndex]?.status !== SceneStatus.VIDEO_PENDING
	) {
		return "keyframes";
	}

	return "rendering";
}

/**
 * Live status copy for the player generating-state (docs §2: "Planning the
 * story…", "Generating keyframes…", "Generating scene N…"). Only ever called
 * while `isFirstGeneration` is true, so `project.status` is always one of
 * draft/planning/storyboard/generating/assembling — never ready/failed.
 * Delegates the phase decision to `getFirstRunPhase` (see above) so this can
 * never disagree with the loader's pattern about which phase is "live".
 */
export function describeFirstRunStatus(
	project: Project,
	scenes: readonly Scene[],
): string {
	const phase = getFirstRunPhase(project, scenes);

	if (phase === "planning") {
		return "Planning the story…";
	}

	if (phase === "keyframes") {
		return "Generating keyframes…";
	}

	const total = scenes.length;
	const activeIndex = scenes.findIndex(
		(scene) => scene.status === SceneStatus.VIDEO_PENDING,
	);

	return `Generating scene ${activeIndex + 1} of ${total}…`;
}
