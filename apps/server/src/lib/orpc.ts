import { implement, ORPCError } from "@orpc/server";
import { appContract } from "@video-platform-challenge/api";

import type { Context } from "./context";

export const o = implement(appContract).$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);
