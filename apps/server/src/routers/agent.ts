import { protectedProcedure } from "../lib/orpc";
import * as agentChatService from "../services/agent-chat.service";

// Contract (inputs/outputs/errors) is fully specified in
// packages/api/src/contracts/agent.ts. Thin: input → service → output, no
// business logic here. The streaming chat turn itself is a raw HTTP route
// (POST /agent/:projectId/chat, apps/server/src/index.ts) — this router only
// covers the initial history load.
export const agentRouter = {
	history: protectedProcedure.agent.history.handler(({ context, input }) =>
		agentChatService.history({ session: context.session, ...input }),
	),
};
