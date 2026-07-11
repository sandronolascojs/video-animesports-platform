import { protectedProcedure } from "../lib/orpc";
import * as searchService from "../services/search.service";

// Contract is fully specified in packages/api/src/contracts/search.ts. Thin:
// input → service → output, no business logic here.
export const searchRouter = {
	query: protectedProcedure.search.query.handler(({ context, input }) =>
		searchService.query({ session: context.session, ...input }),
	),
};
