import { oc } from "@orpc/contract";

import { conflictError, notFoundError, rateLimitedError } from "../errors";
import {
	removeSceneInputSchema,
	removeSceneOutputSchema,
	retrySceneInputSchema,
	sceneSchema,
	updateSceneInputSchema,
} from "../schemas/scene";

// All procedures below run behind `protectedProcedure`; ownership is
// resolved by the scene's own denormalized `userId`, not by the caller
// passing a projectId (docs §5c.4, §5d.1).
export const scenesContract = {
	/**
	 * Edits scene fields (prompt/dialogue/subtitleText/durationSeconds).
	 * Does NOT regenerate assets automatically — a manual edit marks the
	 * scene's existing keyframes/clip stale, regeneration is a separate
	 * call (docs/studio-ui.md §2). Called by the Studio Assets & Scenes
	 * panel and the agent's `updateScene` tool. CONFLICT (docs §8e): once
	 * the scene is `video_ready`, `dialogue`/`durationSeconds` are locked
	 * (already baked into the generated clip's audio) — retry the scene
	 * instead. `subtitleText` stays editable at any status.
	 */
	update: oc
		.input(updateSceneInputSchema)
		.output(sceneSchema)
		.errors({ NOT_FOUND: notFoundError, CONFLICT: conflictError }),

	/**
	 * Re-kicks a failed scene's generation from its last completed step —
	 * the `generations` row is the resume anchor (docs §5c.1). Rejects with
	 * CONFLICT if the scene isn't currently `failed`. Called by the
	 * storyboard's per-scene Retry action.
	 */
	retry: oc.input(retrySceneInputSchema).output(sceneSchema).errors({
		NOT_FOUND: notFoundError,
		CONFLICT: conflictError,
		RATE_LIMITED: rateLimitedError,
	}),

	/**
	 * Removes a scene and returns the corrected draft timeline (entries
	 * referencing the removed scene are dropped server-side). Called by the
	 * Studio timeline strip's delete action and the agent's `removeScene`
	 * tool.
	 */
	remove: oc
		.input(removeSceneInputSchema)
		.output(removeSceneOutputSchema)
		.errors({ NOT_FOUND: notFoundError }),
};
