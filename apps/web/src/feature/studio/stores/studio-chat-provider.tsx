"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentMessage } from "@video-platform-challenge/api";
import { env } from "@video-platform-challenge/env/web";
import type { ChatStatus, UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type { ToolPart } from "@/components/ai-elements/tool";
import { useAgentHistory } from "@/feature/studio/hooks/http/use-agent-chat";
import { orpc } from "@/libs/orpc";
import { toastMutationError } from "@/libs/orpc/mutation-error";
import { getServerUrl } from "@/libs/utils";

/** Narrows a `UIMessage` part to a tool-call/result part (mirrors
 * `agent-chat-sidebar.tsx`'s own local `isToolPart`) — needed before reading
 * `state`/`toolCallId`, which only tool-shaped parts carry. */
function isToolResultPart(part: UIMessage["parts"][number]): part is ToolPart {
	return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

// Tool names that mutate the project's live state outside the chat turn
// itself (docs/ai-architecture-v1.md §2: long-running generations "return
// immediately once the work is queued... the existing polling/SSE keeps the
// editor honest"). After any of these completes, `projects.get` is
// invalidated so the editor doesn't sit on a stale snapshot until the RT-3
// SSE channel's next pushed event (or the slow fallback poll's next tick —
// `useProject`).
const PROJECT_MUTATING_TOOL_PART_TYPES = new Set([
	"tool-extend_scenes",
	"tool-retry_scene",
	"tool-render_version",
	"tool-update_languages",
]);

/** Shared double-submit guard (docs §8a fix 3): both `StudioDock` and the
 * sidebar's `AgentChatComposer` gate their submit handler on this — a
 * turn already in flight must not accept a second concurrent send. */
export function isChatWorking(status: ChatStatus): boolean {
	return status === "submitted" || status === "streaming";
}

function toUIMessage(message: AgentMessage): UIMessage {
	return {
		id: message.id,
		role: message.role,
		parts: message.parts as UIMessage["parts"],
	};
}

/** Merge-by-id backfill (docs §8a fix 4): persisted history wins on id
 * conflict, any in-flight/local message not yet known to persistence is kept
 * and appended after — this is what makes it safe to seed history AFTER the
 * user already sent a message while `useAgentHistory` was still resolving
 * (nothing gets hidden or clobbered either way). */
function mergeHistoryWithLocalMessages(
	history: AgentMessage[],
	local: UIMessage[],
): UIMessage[] {
	const historyIds = new Set(history.map((message) => message.id));
	return [
		...history.map(toUIMessage),
		...local.filter((message) => !historyIds.has(message.id)),
	];
}

export type StudioChatContextValue = {
	/**
	 * Whether `AgentChatSidebar` is open. Default `false` (the floating
	 * `AIDock` stays visible) — docs/ai-architecture-v1.md §2 "Dock ↔
	 * sidebar: two views of ONE chat": the dock and the sidebar are the same
	 * conversation in two states, NEVER both visible at once.
	 */
	isOpen: boolean;
	/** Opens the sidebar (and, per the spec above, the dock's caller should hide itself). */
	open: () => void;
	/** Closes the sidebar back down to the dock. */
	close: () => void;
	/** The live per-project conversation — shared by both the dock and the sidebar (docs "one input, two shells"). */
	messages: UIMessage[];
	/** Sends a message through the SAME chat regardless of which shell (dock or sidebar) called it. Resolves once the turn's stream finishes. */
	sendMessage: (message: { text: string }) => Promise<void>;
	/** Streaming status, forwarded to `AIDockInput`'s submit affordance. */
	status: ChatStatus;
	/** Set once a turn's stream fails (`useChat`'s own `onError` also fires a toast — see `StudioChatProvider` doc comment). `undefined` outside an error state. */
	error: Error | undefined;
	/** Re-sends the last user turn — the sidebar's inline error row's Retry affordance. Regenerates the last assistant message if one exists. */
	regenerate: () => void;
	/** Clears the current error state, e.g. right before a Retry re-issues the turn. */
	clearError: () => void;
	/** Aborts the in-flight stream — wired to the dock/composer's Stop affordance (`PromptInputSubmit`'s `onStop`). */
	stop: () => void;
};

const StudioChatContext = createContext<StudioChatContextValue | null>(null);

/**
 * Dock↔sidebar exclusivity switch AND the single chat owner for the Studio
 * (docs/ai-architecture-v1.md §2). AI-3 scoped this to local UI state only
 * (`isOpen`); AI-4 adds the real `useChat` session on top of the exact same
 * provider so both `AgentChatSidebar` and the dock (`StudioDock`, mounted as
 * a sibling further down the tree) read one shared conversation.
 *
 * History is fetched client-side (`useAgentHistory`), not SSR-prefetched:
 * this provider is mounted in the route's `layout.tsx`, which also renders
 * the Studio page's own not-found fallback as a sibling — an SSR fetch here
 * that threw on a since-deleted/foreign project would crash past that
 * designed empty state instead of degrading gracefully. `useChat`'s
 * `messages` init option is only read once (on mount), so a plain
 * `useQuery` result that resolves later needs an explicit backfill — the
 * effect below does that, guarded so it never clobbers a message the user
 * already sent while history was still loading.
 */
export function StudioChatProvider({
	projectId,
	children,
}: {
	projectId: string;
	children: ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const queryClient = useQueryClient();
	const history = useAgentHistory(projectId);
	// "Don't re-run after applied" (docs §8a fix 4): a ref, not a
	// `messages.length === 0` guard — the old guard permanently skipped
	// backfill once the user sent a message before history resolved. This
	// flag fires the merge exactly once regardless of what's already in
	// `messages` at that point.
	const historyAppliedRef = useRef(false);
	// Tracks which mutating tool calls already triggered an invalidation
	// (docs §8a fix 7) so a re-render over the same streamed message doesn't
	// invalidate `projects.get` more than once per tool call.
	const invalidatedToolCallIdsRef = useRef(new Set<string>());

	const transport = useMemo(
		() =>
			new DefaultChatTransport({
				api: `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/agent/${projectId}/chat`,
				credentials: "include",
			}),
		[projectId],
	);

	const invalidateProjectQuery = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.projects.get.queryOptions({
				input: { id: projectId },
			}).queryKey,
		});
	};

	const {
		messages,
		sendMessage,
		status,
		setMessages,
		error,
		regenerate,
		clearError,
		stop,
	} = useChat({
		id: projectId,
		transport,
		// Backstop (docs §8a fix 7): the per-tool-call effect below already
		// invalidates as soon as a mutating tool's result streams in, but this
		// stays as a safety net for any part shape that effect doesn't catch.
		onFinish: ({ message }) => {
			const mutatedProject = message.parts.some((part) =>
				PROJECT_MUTATING_TOOL_PART_TYPES.has(part.type),
			);
			if (mutatedProject) {
				invalidateProjectQuery();
			}
		},
		// Batch C fix 2: `useChat` swallows a failed turn into its own `error`/
		// `status: "error"` state internally and never rejects `sendMessage`'s
		// promise for a stream-time failure — nothing surfaced it to the user
		// before this, so a broken turn silently left a blank assistant bubble
		// with no toast and no way to retry. This is the ONE place a chat
		// failure becomes visible; `error` is also exposed below so the sidebar
		// can render an inline Retry row for as long as the error persists.
		onError: (chatError) => {
			console.error("Studio agent chat error:", chatError);
			toastMutationError(chatError, { title: "Director hit an error" });
		},
	});

	useEffect(() => {
		if (!history.data || historyAppliedRef.current) {
			return;
		}
		historyAppliedRef.current = true;
		if (history.data.length === 0) {
			return;
		}
		const persisted = history.data;
		setMessages((current) => mergeHistoryWithLocalMessages(persisted, current));
	}, [history.data, setMessages]);

	// docs §8a fix 7: invalidate `projects.get` as soon as a mutating tool's
	// result streams in (output-available), not only once the WHOLE turn
	// finishes — a multi-step turn (e.g. get_project_state -> extend_scenes ->
	// summarize) would otherwise sit on a stale dock/editor snapshot until the
	// closing text summary lands too.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `invalidateProjectQuery` intentionally omitted — it closes over `projectId`/`queryClient`, both stable for this provider's lifetime (the `projectId` prop never changes without remounting the provider).
	useEffect(() => {
		for (const message of messages) {
			for (const part of message.parts) {
				if (
					!isToolResultPart(part) ||
					!PROJECT_MUTATING_TOOL_PART_TYPES.has(part.type) ||
					part.state !== "output-available"
				) {
					continue;
				}
				if (invalidatedToolCallIdsRef.current.has(part.toolCallId)) {
					continue;
				}
				invalidatedToolCallIdsRef.current.add(part.toolCallId);
				invalidateProjectQuery();
			}
		}
	}, [messages]);

	const value = useMemo<StudioChatContextValue>(
		() => ({
			clearError,
			close: () => setIsOpen(false),
			error,
			isOpen,
			messages,
			open: () => setIsOpen(true),
			regenerate: () => {
				void regenerate();
			},
			sendMessage,
			status,
			stop: () => {
				void stop();
			},
		}),
		[
			isOpen,
			messages,
			sendMessage,
			status,
			error,
			regenerate,
			clearError,
			stop,
		],
	);

	return (
		<StudioChatContext.Provider value={value}>
			{children}
		</StudioChatContext.Provider>
	);
}

export function useStudioChat(): StudioChatContextValue {
	const context = useContext(StudioChatContext);
	if (!context) {
		throw new Error("useStudioChat must be used within a StudioChatProvider");
	}
	return context;
}
