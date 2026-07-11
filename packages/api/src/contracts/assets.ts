import { oc } from "@orpc/contract";

import { notFoundError } from "../errors";
import {
	assetDownloadUrlSchema,
	createUploadInputSchema,
	createUploadOutputSchema,
	getAssetDownloadUrlInputSchema,
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
	 * Issues a short-lived signed GET URL for an asset's R2 object — R2
	 * stays private, this is the only sanctioned read path (docs §5d.10).
	 * Called by the Studio Player/timeline thumbnails, the storyboard, and
	 * the asset browser for playback/preview/download.
	 */
	getDownloadUrl: oc
		.input(getAssetDownloadUrlInputSchema)
		.output(assetDownloadUrlSchema)
		.errors({ NOT_FOUND: notFoundError }),

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
