import { oc } from "@orpc/contract";
import z from "zod";

import {
	conflictError,
	generationFailedError,
	invalidTimelineError,
	notFoundError,
	rateLimitedError,
} from "../errors";
import {
	projectsPageInputSchema,
	projectsPageOutputSchema,
} from "../schemas/page";
import {
	createProjectInputSchema,
	deleteProjectInputSchema,
	extendProjectInputSchema,
	getProjectInputSchema,
	listProjectsInputSchema,
	listProjectsOutputSchema,
	projectDetailSchema,
	projectSchema,
	projectSummarySchema,
	updateDraftTimelineInputSchema,
	updateLanguagesInputSchema,
	updateSubtitleStyleInputSchema,
} from "../schemas/project";
import { sceneSchema } from "../schemas/scene";

// All procedures below run behind `protectedProcedure` (session required) in
// apps/server — this contract file only declares shapes and errors, never
// transport/auth concerns (docs §5d.6). The unauthenticated starter
// `healthCheck`/`privateData` procedures were removed as unreferenced
// starter leftovers — the real health probe is index.ts's raw `GET /`.
export const projectsContract = {
	/**
	 * Creates a project, runs the plan step (agent → title/synopsis/3 scenes,
	 * synchronous), and kicks the 3-scene asset generation server-side
	 * (docs §1, §9 "Create + plan"). Called by the Home composer on submit.
	 */
	create: oc
		.input(createProjectInputSchema)
		.output(projectSummarySchema)
		.errors({
			GENERATION_FAILED: generationFailedError,
			RATE_LIMITED: rateLimitedError,
		}),

	/**
	 * Lists the caller's own projects, newest first (limit/offset
	 * pagination — see schemas/project.ts for the pagination-choice
	 * rationale). Called by the Home "recent projects" grid and the
	 * projects list view.
	 */
	list: oc.input(listProjectsInputSchema).output(listProjectsOutputSchema),

	/**
	 * Paginated project cards for the /projects page — shared `{ items, meta }`
	 * envelope (packages/types pagination contract). Each item carries the id
	 * of its first READY scene video (or final render) so the card can loop a
	 * real preview.
	 */
	page: oc.input(projectsPageInputSchema).output(projectsPageOutputSchema),

	/**
	 * Full project detail: row + scenes[] + assets[] + versions[]. The
	 * Studio's polling surface for the generating state — carries
	 * everything the Studio needs to render the storyboard, canvas,
	 * timeline, and history panel. Called on Studio SSR load and repeatedly
	 * via polling while any scene/version is still generating.
	 */
	get: oc
		.input(getProjectInputSchema)
		.output(projectDetailSchema)
		.errors({ NOT_FOUND: notFoundError }),

	/**
	 * Persists the draft timeline (reorder/replace/duration edits) — the
	 * ONLY scene-ordering authority (docs §6, §9). Server validates every
	 * entry's `sceneId` belongs to this project. Called by the Studio
	 * timeline strip on every drag/drop/edit (debounced) and the agent's
	 * `reorderScenes` tool.
	 */
	updateDraftTimeline: oc
		.input(updateDraftTimelineInputSchema)
		.output(projectSchema)
		.errors({
			NOT_FOUND: notFoundError,
			INVALID_TIMELINE: invalidTimelineError,
		}),

	/**
	 * Updates the project's subtitle style object — drives both the live
	 * Player overlay and the ASS burn-in track at render time (docs §5b).
	 * Called by the Studio Subtitles tab on every style tweak.
	 */
	updateSubtitleStyle: oc
		.input(updateSubtitleStyleInputSchema)
		.output(projectSchema)
		.errors({ NOT_FOUND: notFoundError }),

	/**
	 * Updates audio/subtitle language selection — independent of each
	 * other (docs §5b). Called by the Home composer's language chips and
	 * the Studio dock's language selectors.
	 */
	updateLanguages: oc
		.input(updateLanguagesInputSchema)
		.output(projectSchema)
		.errors({ NOT_FOUND: notFoundError }),

	/**
	 * Extends the story by exactly one scene, chained from the current last
	 * end keyframe — existing assets never regenerate (docs §2, §7). Runs
	 * the extendStory plan step synchronously, then kicks that scene's
	 * asset generation. Called by the Studio "add scene" action and the
	 * agent's `addScene` tool.
	 */
	extend: oc.input(extendProjectInputSchema).output(sceneSchema).errors({
		NOT_FOUND: notFoundError,
		CONFLICT: conflictError,
		GENERATION_FAILED: generationFailedError,
		RATE_LIMITED: rateLimitedError,
	}),

	/**
	 * Deletes a project and everything under it (cascade — docs §5d.4).
	 * Called by the project list row action and the Studio topbar menu.
	 */
	delete: oc
		.input(deleteProjectInputSchema)
		.output(z.void())
		.errors({ NOT_FOUND: notFoundError }),
};
