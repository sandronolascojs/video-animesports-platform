import { protectedProcedure } from "../lib/orpc";
import * as sceneService from "../services/scene.service";

// Contract is fully specified in packages/api/src/contracts/scenes.ts. Thin:
// input → service → output, no business logic here.
export const scenesRouter = {
	update: protectedProcedure.scenes.update.handler(({ context, input }) =>
		sceneService.update({ session: context.session, ...input }),
	),
	retry: protectedProcedure.scenes.retry.handler(({ context, input }) =>
		sceneService.retry({ session: context.session, ...input }),
	),
	remove: protectedProcedure.scenes.remove.handler(({ context, input }) =>
		sceneService.remove({ session: context.session, ...input }),
	),
};
