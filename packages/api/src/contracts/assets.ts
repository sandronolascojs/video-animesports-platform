import { oc } from "@orpc/contract";

import { notFoundError } from "../errors";
import {
	createUploadInputSchema,
	createUploadOutputSchema,
	getProjectAssetUrlsInputSchema,
	projectAssetUrlsSchema,
} from "../schemas/asset";
import { assetsPageInputSchema, assetsPageOutputSchema } from "../schemas/page";

export const assetsContract = {
	/**
	 * Paginated asset cards for the /assets page — shared `{ items, meta }`
	 * envelope (packages/types pagination contract), each item joined with its
	 * project (title/template) and owning scene's prompt for the info modal.
	 */
	page: oc.input(assetsPageInputSchema).output(assetsPageOutputSchema),

	/**
	 * Batch: every signed asset URL for one project in a single call — the only
	 * sanctioned read path for R2 objects (docs §5d.10), feeding the Studio
	 * player/panels, storyboard, and asset browser. R2 keys never leave the
	 * server; only short-lived signed URLs are returned.
	 */
	getProjectUrls: oc
		.input(getProjectAssetUrlsInputSchema)
		.output(projectAssetUrlsSchema),

	/**
	 * Creates a pending `render`-kind asset row and issues a presigned PUT
	 * (≤15min, docs §5d.10) for the browser-side Mediabunny remux/export flow
	 * (docs §5, §9 "MVP path (browser)"). The caller uploads the finished MP4
	 * directly to R2 with this URL, then calls `versions.markRendered` to
	 * complete the flow. Called by the Studio export action.
	 */
	createUpload: oc
		.input(createUploadInputSchema)
		.output(createUploadOutputSchema)
		.errors({ NOT_FOUND: notFoundError }),
};
