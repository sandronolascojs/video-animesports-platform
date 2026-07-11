import { oc } from "@orpc/contract";

import { conflictError, generationFailedError, notFoundError } from "../errors";
import {
	cancelVersionInputSchema,
	cancelVersionOutputSchema,
	listVersionsInputSchema,
	listVersionsOutputSchema,
	markVersionRenderedInputSchema,
	renderVersionInputSchema,
	restoreVersionInputSchema,
	restoreVersionOutputSchema,
	versionSchema,
} from "../schemas/version";

export const versionsContract = {
	/**
	 * Snapshots the current draft timeline into a new immutable version and
	 * kicks the canonical render/assembly (docs §9). Rejects with CONFLICT
	 * if the project already has a version rendering. Called by the Studio
	 * timeline strip's Render button and the agent's `renderVersion` tool.
	 */
	render: oc.input(renderVersionInputSchema).output(versionSchema).errors({
		NOT_FOUND: notFoundError,
		CONFLICT: conflictError,
	}),

	/**
	 * Lists a project's versions, newest first — the History panel's data
	 * source (docs §9 "Editor state, history panel, undo/redo").
	 */
	list: oc
		.input(listVersionsInputSchema)
		.output(listVersionsOutputSchema)
		.errors({ NOT_FOUND: notFoundError }),

	/**
	 * Returns a version's timeline snapshot for the client to apply via
	 * `projects.updateDraftTimeline` — restoring never mutates or deletes
	 * the version itself (docs §9, non-destructive history). Called by the
	 * History panel's "restore" action.
	 */
	restore: oc
		.input(restoreVersionInputSchema)
		.output(restoreVersionOutputSchema)
		.errors({ NOT_FOUND: notFoundError }),

	/**
	 * Marks a version's assembly complete and attaches the render asset —
	 * the completion signal for the R1 browser Mediabunny remux flow (docs
	 * §5, §9 "MVP path (browser)": remux → multipart upload to R2 →
	 * `versions.markRendered`). Not in the original endpoint list; added
	 * because the doc names this exact call and the browser render path has
	 * no other way to report back. Called by the Studio export flow after
	 * the browser-side remux + upload completes. A post-upload HEAD check
	 * (docs §5d.10) verifies the real object before trusting it —
	 * GENERATION_FAILED if that verification fails.
	 */
	markRendered: oc
		.input(markVersionRenderedInputSchema)
		.output(versionSchema)
		.errors({
			NOT_FOUND: notFoundError,
			CONFLICT: conflictError,
			GENERATION_FAILED: generationFailedError,
		}),

	/**
	 * REN-3 (docs ai-architecture-v1.md §5 finding 3): cancels the project's
	 * currently `rendering` version (if any), transitioning it straight to
	 * `failed` — the server-side reconciliation the Studio export flow's
	 * `cancel()` calls (fire-and-forget) so an aborted export doesn't leave
	 * a `rendering` row alive for the full `RENDER_ABANDON_MINUTES` window,
	 * blocking an immediate retry with CONFLICT. Idempotent/quiet by design
	 * — see `cancelVersionOutputSchema`'s doc comment — never errors just
	 * because there was nothing to cancel.
	 */
	cancel: oc.input(cancelVersionInputSchema).output(cancelVersionOutputSchema),
};
