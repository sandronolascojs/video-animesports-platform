import {
	AssetSortField,
	createPaginatedResponseSchema,
	createPaginationQuerySchema,
	ProjectSortField,
} from "@video-platform-challenge/types";
import z from "zod";

import { assetKindSchema, assetStatusSchema } from "./asset";
import { projectStatusSchema, templateKeySchema } from "./project";

/**
 * Paginated list surfaces for the /projects and /assets pages. Inputs and
 * the `{ items, meta }` envelope come from the shared pagination contract
 * in `packages/types` — every paginated endpoint speaks the same shape.
 */

export const projectsPageInputSchema = createPaginationQuerySchema(
	ProjectSortField,
).extend({
	// Optional filters (the page's filter popover).
	status: projectStatusSchema.optional(),
	templateKey: templateKeySchema.optional(),
});

export const projectPageItemSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	status: projectStatusSchema,
	templateKey: templateKeySchema,
	createdAt: z.date(),
	// First READY scene video → final render → first keyframe still — the
	// card's own preview; null until the project has produced any media.
	previewAssetId: z.string().nullable(),
	// Which kind `previewAssetId` points at, so the card knows to play it as a
	// video or paint it as an image. Null when there's no preview yet.
	previewKind: assetKindSchema.nullable(),
	// Signed GET URL for `previewAssetId` (server-minted, no extra round-trip).
	previewUrl: z.string().nullable(),
});

export const projectsPageOutputSchema = createPaginatedResponseSchema(
	projectPageItemSchema,
);

export const assetsPageInputSchema = createPaginationQuerySchema(
	AssetSortField,
).extend({
	// Optional filters (the page's filter popover).
	kind: assetKindSchema.optional(),
	status: assetStatusSchema.optional(),
});

export const assetPageItemSchema = z.object({
	id: z.string(),
	kind: assetKindSchema,
	status: assetStatusSchema,
	createdAt: z.date(),
	projectId: z.string(),
	projectTitle: z.string().nullable(),
	projectTemplateKey: templateKeySchema,
	// The owning scene's prompt when the asset hangs off a scene (keyframes,
	// scene videos) — the modal's "what is this" copy.
	scenePrompt: z.string().nullable(),
	// Signed GET URL for this asset's R2 object (server-minted, no extra
	// round-trip). Null when the asset has no r2Key yet.
	downloadUrl: z.string().nullable(),
});

export const assetsPageOutputSchema =
	createPaginatedResponseSchema(assetPageItemSchema);

export type ProjectsPageInput = z.infer<typeof projectsPageInputSchema>;
export type ProjectPageItem = z.infer<typeof projectPageItemSchema>;
export type AssetsPageInput = z.infer<typeof assetsPageInputSchema>;
export type AssetPageItem = z.infer<typeof assetPageItemSchema>;
