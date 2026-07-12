"use client";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/libs/orpc";

/**
 * Per-project chat history (docs/ai-architecture-v1.md §2 "Chat semantics")
 * — `StudioChatProvider` seeds its live `useChat` session from this once it
 * resolves (see that file's doc comment for why an effect, not `useChat`'s
 * own init option, does the backfill).
 */
export function useAgentHistory(projectId: string) {
	return useQuery(orpc.agent.history.queryOptions({ input: { projectId } }));
}
