import { VersionStatus } from "@video-platform-challenge/types";
import z from "zod";

import { timelineEntrySchema } from "./scene";

export const versionStatusSchema = z.enum([...Object.values(VersionStatus)]);

/**
 * An immutable `project_versions` row. Created ONLY by `versions.render`
 * (one render = one version — docs §9 "Editor state, history panel,
 * undo/redo"). Doubles as the lean "summary" shape embedded in
 * `projects.get`'s detail payload — the row never carries more than this.
 */
export const versionSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	number: z.number().int(),
	timeline: z.array(timelineEntrySchema),
	renderAssetId: z.string().nullable(),
	status: versionStatusSchema,
	failReason: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const renderVersionInputSchema = z.object({
	projectId: z.string(),
});

export const listVersionsInputSchema = z.object({
	projectId: z.string(),
});

export const listVersionsOutputSchema = z.array(versionSchema);

export const restoreVersionInputSchema = z.object({
	id: z.string(),
});

// Returns the timeline snapshot ONLY — the client applies it via
// `projects.updateDraftTimeline` to persist it. Restoring never mutates the
// version itself (docs §9, non-destructive history).
export const restoreVersionOutputSchema = z.object({
	timeline: z.array(timelineEntrySchema),
});

// Marks a version's assembly complete and attaches the render asset — the
// completion signal for the R1 browser Mediabunny remux flow (docs §5, §9
// "MVP path (browser)": remux → multipart upload to R2 →
// `versions.markRendered(versionId, assetId)`).
export const markVersionRenderedInputSchema = z.object({
	id: z.string(),
	renderAssetId: z.string(),
});

// REN-3: reconciles the server row when the client's export cancel() fires
// — cancels the project's CURRENT `rendering` version (if any, and if owned
// by the caller), never a specific version id (the client may not even have
// one yet if it aborts before `versions.render` resolves).
export const cancelVersionInputSchema = z.object({
	projectId: z.string(),
});

export const cancelVersionOutputSchema = z.object({
	/** False when there was nothing to cancel (idempotent, quiet — see the
	 * contract doc comment) — never a distinguishing error. */
	canceled: z.boolean(),
});

export type VersionStatusValue = z.infer<typeof versionStatusSchema>;
export type Version = z.infer<typeof versionSchema>;
export type RenderVersionInput = z.infer<typeof renderVersionInputSchema>;
export type ListVersionsInput = z.infer<typeof listVersionsInputSchema>;
export type RestoreVersionInput = z.infer<typeof restoreVersionInputSchema>;
export type RestoreVersionOutput = z.infer<typeof restoreVersionOutputSchema>;
export type MarkVersionRenderedInput = z.infer<
	typeof markVersionRenderedInputSchema
>;
export type CancelVersionInput = z.infer<typeof cancelVersionInputSchema>;
export type CancelVersionOutput = z.infer<typeof cancelVersionOutputSchema>;
