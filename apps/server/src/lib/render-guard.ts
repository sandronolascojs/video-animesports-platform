// Pure guard logic for version.service.ts::render (RT-1, docs
// realtime-and-render-lock-v1.md §3): a new version may only start
// rendering once the project itself has settled `ready` AND every one of
// its scenes has reached `video_ready`. This closes the gap the client-side
// `canRender` preflight (use-render-export.tsx) can't: that check only
// disables the button, so the agent's `render_version` tool or a direct API
// call could still kick a `rendering` version row while generation is
// mid-flight. Kept DB-free (no db/env import — see lib/mark-rendered.ts's
// doc comment for why other lib/*.ts files in this app do the same) so the
// decision is testable under plain `bun:test` without a live project/scene
// row.
import { ProjectStatus, SceneStatus } from "@video-platform-challenge/types";

export const RENDER_GUARD_MESSAGE =
	"Finish generating all scenes before rendering a version.";

/** The subset of a scene row this guard inspects. */
export interface RenderGuardScene {
	status: SceneStatus;
}

/**
 * True only when the project has settled to `ready` and has at least one
 * scene, all of them `video_ready`. An empty scene list is deliberately
 * blocked (there is nothing to render, and `ready` alone can't distinguish
 * "generation finished with scenes ready" from a pathological zero-scene
 * project) — mirrors the client's own `canRender` gate
 * (`orderedScenes.length === timeline.length && orderedScenes.every(...)`)
 * but is the authoritative server-side check.
 */
export function canRenderProject(
	projectStatus: ProjectStatus,
	scenes: readonly RenderGuardScene[],
): boolean {
	if (projectStatus !== ProjectStatus.READY) {
		return false;
	}
	return (
		scenes.length > 0 &&
		scenes.every((scene) => scene.status === SceneStatus.VIDEO_READY)
	);
}
