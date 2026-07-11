// Pure guard logic for scene.service.ts::update (AI-6a §8e finding 2's
// sibling bug — STALE-SUBTITLE was one half of "editing after video_ready
// desyncs the row from what was actually rendered"; dialogue and duration
// are the other half). Kept DB-free (no db/env import — see
// lib/mark-rendered.ts's doc comment for why other lib/*.ts files in this
// app do the same) so the field-lock decision is testable under plain
// `bun:test` without a live scene row.
import { SceneStatus } from "@video-platform-challenge/types";

export const STALE_DIALOGUE_GUARD_MESSAGE =
	"This scene's video already has baked-in audio for its current dialogue and duration — retry the scene to change spoken dialogue or duration.";

/** The subset of `UpdateSceneInput` this guard inspects — a patch only ever
 * carries the fields the caller actually wants to change (every field is
 * optional on the real `UpdateSceneInput` too). */
export interface SceneUpdatePatch {
	dialogue?: string;
	durationSeconds?: number;
	prompt?: string;
	subtitleText?: string;
}

/**
 * True when `patch` touches a field that's locked once the scene reached
 * `video_ready` (docs §8e): the clip's audio track is TTS baked in at
 * generation time from that exact `dialogue`/`durationSeconds` pair — editing
 * either afterwards would silently desync the row from what was actually
 * rendered (a longer duration plays as dead time, a changed line contradicts
 * the baked voice). `subtitleText` is deliberately NOT locked: captions are
 * burned in at EXPORT time from the CURRENT row, independent of the already-
 * baked audio, so editing it post-generation is always safe. `prompt` is
 * also never locked by this guard (it only affects a FUTURE regeneration via
 * retry, never the already-baked clip).
 */
export function isLockedSceneFieldEdit(
	status: SceneStatus,
	patch: SceneUpdatePatch,
): boolean {
	if (status !== SceneStatus.VIDEO_READY) {
		return false;
	}
	return patch.dialogue !== undefined || patch.durationSeconds !== undefined;
}
