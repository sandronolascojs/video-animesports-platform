import {
	AssetKind,
	AssetStatus,
	MAX_RENDER_UPLOAD_SIZE_BYTES,
} from "@video-platform-challenge/types";
import z from "zod";

export const assetKindSchema = z.enum([...Object.values(AssetKind)]);
export const assetStatusSchema = z.enum([...Object.values(AssetStatus)]);

export const assetMetadataSchema = z.object({
	width: z.number().optional(),
	height: z.number().optional(),
	durationSeconds: z.number().optional(),
});

/**
 * An asset row, MINUS `r2Key` and `source` (the owning generation_tasks
 * row's id — see that column's doc comment): R2 stays private — the only
 * sanctioned way to reach the underlying object is `assets.getProjectUrls`,
 * which mints short-lived signed GET URLs server-side. Never expose the raw
 * R2 key to the client.
 */
export const assetSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	kind: assetKindSchema,
	status: assetStatusSchema,
	contentType: z.string().nullable(),
	size: z.number().int().nullable(),
	// Kind-specific bag (width/height for images & video, duration for
	// video/audio) — see assetMetadataSchema's doc comment (docs §6).
	metadata: assetMetadataSchema.nullable(),
	failReason: z.string().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const getProjectAssetUrlsInputSchema = z.object({
	projectId: z.string(),
});

export const projectAssetUrlSchema = z.object({
	assetId: z.string(),
	url: z.string(),
	expiresAt: z.date(),
});

export const projectAssetUrlsSchema = z.array(projectAssetUrlSchema);

/**
 * Issues a presigned PUT for the browser-side Mediabunny remux/export flow
 * (docs §5, §9 "MVP path (browser)") — the missing contract piece the R1
 * render path needs: browser assembles the MP4 client-side, uploads it here,
 * then reports completion via `versions.markRendered`. `kind` is pinned to
 * `render` (a `z.literal`, not the full `assetKindSchema`) — every other
 * asset kind is produced server-side by the generation pipeline, never
 * uploaded by a client (docs phase 3b-2 design anchor 6).
 */
export const createUploadInputSchema = z.object({
	projectId: z.string(),
	contentType: z.string().min(1).max(120),
	// Client-declared size — bounds what we're willing to sign for. This
	// alone cannot enforce the real upload size (a presigned PUT can't cap
	// bytes); `versions.markRendered`'s post-upload HEAD check re-verifies
	// the actual object against this same bound (docs §5d.10).
	size: z.number().int().positive().max(MAX_RENDER_UPLOAD_SIZE_BYTES),
	kind: z.literal(AssetKind.RENDER),
});

export const createUploadOutputSchema = z.object({
	assetId: z.string(),
	uploadUrl: z.string(),
	expiresAt: z.date(),
});

export type AssetKindValue = z.infer<typeof assetKindSchema>;
export type AssetStatusValue = z.infer<typeof assetStatusSchema>;
export type AssetMetadataValue = z.infer<typeof assetMetadataSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type GetProjectAssetUrlsInput = z.infer<
	typeof getProjectAssetUrlsInputSchema
>;
export type ProjectAssetUrls = z.infer<typeof projectAssetUrlsSchema>;
export type CreateUploadInput = z.infer<typeof createUploadInputSchema>;
export type CreateUploadOutput = z.infer<typeof createUploadOutputSchema>;
