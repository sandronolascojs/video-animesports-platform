import { protectedProcedure } from "../lib/orpc";
import * as assetService from "../services/asset.service";

// Contract is fully specified in packages/api/src/contracts/assets.ts. Thin:
// input → service → output, no business logic here.
export const assetsRouter = {
	page: protectedProcedure.assets.page.handler(({ context, input }) =>
		assetService.page({ session: context.session, ...input }),
	),
	getDownloadUrl: protectedProcedure.assets.getDownloadUrl.handler(
		({ context, input }) =>
			assetService.getDownloadUrl({ session: context.session, ...input }),
	),
	createUpload: protectedProcedure.assets.createUpload.handler(
		({ context, input }) =>
			assetService.createUpload({ session: context.session, ...input }),
	),
};
