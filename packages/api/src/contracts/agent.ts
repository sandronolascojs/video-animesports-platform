import { oc } from "@orpc/contract";

import { notFoundError } from "../errors";
import {
	agentHistoryInputSchema,
	agentHistoryOutputSchema,
} from "../schemas/agent";

// The streaming chat turn itself is NOT an oRPC procedure — it's a raw HTTP
// route (`POST /agent/:projectId/chat`, mounted in apps/server/src/index.ts
// beside `/rpc`) so it can return an AI SDK UI-message stream response
// directly (docs ai-architecture-v1.md §2 "Transport"). This contract only
// covers the initial history load the Studio chat sidebar/dock hydrate from.
export const agentContract = {
	/**
	 * Loads a project's persisted chat log, oldest first — the Studio chat's
	 * initial `useChat` seed (docs §2 "Chat semantics": history is per
	 * PROJECT, not per version). Called once per Studio session by
	 * `StudioChatProvider`.
	 */
	history: oc
		.input(agentHistoryInputSchema)
		.output(agentHistoryOutputSchema)
		.errors({ NOT_FOUND: notFoundError }),
};
