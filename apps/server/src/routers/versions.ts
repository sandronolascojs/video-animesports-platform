import { protectedProcedure } from "../lib/orpc";
import * as versionService from "../services/version.service";

// Contract is fully specified in packages/api/src/contracts/versions.ts.
// Thin: input → service → output, no business logic here.
export const versionsRouter = {
	render: protectedProcedure.versions.render.handler(({ context, input }) =>
		versionService.render({ session: context.session, ...input }),
	),
	list: protectedProcedure.versions.list.handler(({ context, input }) =>
		versionService.list({ session: context.session, ...input }),
	),
	restore: protectedProcedure.versions.restore.handler(({ context, input }) =>
		versionService.restore({ session: context.session, ...input }),
	),
	markRendered: protectedProcedure.versions.markRendered.handler(
		({ context, input }) =>
			versionService.markRendered({ session: context.session, ...input }),
	),
	cancel: protectedProcedure.versions.cancel.handler(({ context, input }) =>
		versionService.cancel({ session: context.session, ...input }),
	),
};
