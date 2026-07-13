"use client";

import type { UIMessage } from "ai";
import {
	AlertTriangleIcon,
	BotIcon,
	RotateCcwIcon,
	WrenchIcon,
} from "lucide-react";

import {
	Conversation,
	ConversationContent,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { getStatusBadge, type ToolPart } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { AgentChatComposer } from "@/feature/studio/components/agent-chat-composer";
import { useStudioChat } from "@/feature/studio/stores/studio-chat-provider";

/** The empty state's tappable starters (docs/studio-design-language.md §3d
 * "3 tappable suggestion rows ... that prefill the composer"). Natural
 * language, same voice as the composer's own rotating placeholders — clicking
 * one loads it into the draft via `requestPrefill`, it does not send. */
const CHAT_SUGGESTIONS = [
	"Add 2 more scenes",
	"Retry the failed shot",
	"Render a new version",
];

/**
 * Premium empty state (docs §3d, §1 "Premium empty states"): a soft icon +
 * bold title + one muted hint, then the starter bubbles — each an
 * ai-elements `Suggestion` (outline pill, the same recipe used for
 * recommendation chips elsewhere), stacked full-width instead of the
 * horizontal `Suggestions` scroller (too cramped for this 23rem rail).
 */
function AgentChatEmptyState({
	onSuggestion,
}: {
	onSuggestion: (text: string) => void;
}) {
	return (
		<Empty className="h-full border-none p-6">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<BotIcon />
				</EmptyMedia>
				<EmptyTitle>Direct your episode</EmptyTitle>
				<EmptyDescription>
					Ask the Agent to extend scenes, retry a shot, or render a new version.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<div className="flex w-full flex-col gap-2">
					{CHAT_SUGGESTIONS.map((suggestion) => (
						<Suggestion
							key={suggestion}
							suggestion={suggestion}
							onClick={onSuggestion}
							className="w-full"
						/>
					))}
				</div>
			</EmptyContent>
		</Empty>
	);
}

/** Turns "extend_scenes" into "Extend scenes" for the compact tool-call chip. */
function formatToolLabel(name: string): string {
	const spaced = name.replace(/_/g, " ");
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A small labeled row per tool invocation (docs task: "tool-call parts
 * rendered compactly — a small labeled chip/row per tool invocation is
 * enough") — deliberately NOT the full collapsible `Tool`/`ToolInput`/
 * `ToolOutput` accordion from ai-elements (that renders raw JSON I/O, more
 * detail than a chat sidebar needs); this just reuses `getStatusBadge` for
 * the running/completed/error indicator.
 */
function ToolCallChip({ part }: { part: ToolPart }) {
	const name =
		part.type === "dynamic-tool"
			? part.toolName
			: part.type.slice("tool-".length);

	return (
		<div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-muted/30 px-2.5 py-1.5 text-xs">
			<WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="font-medium">{formatToolLabel(name)}</span>
			{getStatusBadge(part.state)}
		</div>
	);
}

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
	return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/**
 * Batch C fix 2: a turn that errors out BEFORE streaming any text (e.g. the
 * request itself failed) leaves `message.parts` with nothing this component
 * knows how to render — previously that meant an empty `MessageContent`, a
 * blank assistant bubble with no explanation. This renders a subtle fallback
 * line instead, but only for the assistant role: an empty USER message
 * would mean something else broke upstream, not a stream error, so it stays
 * silent rather than guessing.
 */
function ChatMessage({ message }: { message: UIMessage }) {
	const renderedParts = message.parts
		.map((part, index) => {
			if (part.type === "text") {
				return (
					<MessageResponse key={`${message.id}-${index}`}>
						{part.text}
					</MessageResponse>
				);
			}
			if (isToolPart(part)) {
				return <ToolCallChip key={`${message.id}-${index}`} part={part} />;
			}
			return null;
		})
		.filter((part) => part !== null);

	return (
		<Message from={message.role}>
			<MessageContent>
				{renderedParts.length > 0 ? (
					renderedParts
				) : message.role === "assistant" ? (
					<p className="text-muted-foreground text-xs italic">
						The agent hit an error — try again.
					</p>
				) : null}
			</MessageContent>
		</Message>
	);
}

/**
 * The Studio's single chat surface (docs/studio-design-language.md §3d
 * "consolidate the agent chat to the right rail only" — the floating dock is
 * gone, this rail is it). A PERSISTENT `components/ui/sidebar.tsx`
 * `<Sidebar side="right">` — the same primitive `AppSidebar` (the app's left
 * nav rail) is built on — not a conditionally-mounted panel: it's always in
 * the tree, `collapsible="icon"` (mirroring `AppSidebar`'s own collapse mode)
 * drives the expanded/collapsed CSS transition instead of the AnimatePresence
 * mount/unmount this used to do. `variant="floating"` + the
 * `[&_[data-sidebar=sidebar]]:...` override below reproduce `surface-panel`
 * (rounded-2xl, `border-sidebar-border`, no ring/shadow) on the primitive's
 * own inner card — the exact same visual recipe `AppSidebar` uses, so the two
 * rails read as one family. `--sidebar-width` is overridden to 23rem by the
 * right `SidebarProvider` (`projects/[projectId]/layout.tsx`) — the original
 * `--sidebar-width` (16rem) + 20%, widened another ~20% by a later pass for
 * breathing room.
 *
 * The OPEN/CLOSE control lives in this rail's own header (`SidebarTrigger`),
 * not the topbar — `StudioTopbar`'s old toggle button is gone. ⌘J (registered
 * in `StudioChatProvider`) does the same, via the primitive's own
 * `toggleSidebar()`.
 *
 * The composer inside stays the shared `AIDockInput` glass (`glass-composer`)
 * — the rail's own material is `surface-panel`, not stacked glass-on-glass
 * (docs §2 "don't stack glass on glass").
 *
 * AI-4: real messages from `useStudioChat()` (the shared `useChat` session
 * `StudioChatProvider` owns), rendered with the vendored `ai-elements`
 * primitives. `Conversation`/`ConversationContent` wrap `use-stick-to-bottom`
 * internally, so auto-scroll-to-bottom on new messages/streaming content is
 * free — no extra scroll wiring needed here. `SidebarContent` below overrides
 * the primitive's default `overflow-auto` with `overflow-hidden`: scrolling
 * stays owned entirely by `Conversation`'s own `StickToBottom` container, not
 * a second, redundant outer scroller.
 */
export function AgentChatSidebar() {
	const { messages, error, regenerate, clearError, requestPrefill } =
		useStudioChat();

	return (
		<Sidebar
			side="right"
			collapsible="icon"
			variant="floating"
			className="[&_[data-sidebar=sidebar]]:overflow-hidden [&_[data-sidebar=sidebar]]:rounded-2xl [&_[data-sidebar=sidebar]]:border [&_[data-sidebar=sidebar]]:border-sidebar-border [&_[data-sidebar=sidebar]]:shadow-none [&_[data-sidebar=sidebar]]:ring-0"
		>
			<SidebarHeader>
				<div className="flex items-center justify-between gap-2 px-1 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2">
					<div className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
						<BotIcon className="size-4 shrink-0 text-muted-foreground" />
						<h2 className="truncate font-semibold text-sm">Agent</h2>
					</div>
					<SidebarTrigger className="shrink-0" aria-label="Toggle Agent chat" />
				</div>
			</SidebarHeader>

			<SidebarContent className="overflow-hidden group-data-[collapsible=icon]:hidden">
				{messages.length === 0 ? (
					<AgentChatEmptyState onSuggestion={requestPrefill} />
				) : (
					<Conversation>
						<ConversationContent>
							{messages.map((message) => (
								<ChatMessage key={message.id} message={message} />
							))}
						</ConversationContent>
					</Conversation>
				)}
			</SidebarContent>

			<SidebarFooter className="gap-0 p-0 group-data-[collapsible=icon]:hidden">
				{error ? (
					<div className="shrink-0 p-3 pb-0">
						<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
							<div className="flex items-start gap-2">
								<AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
								<p className="text-destructive text-xs">
									{error.message || "The agent hit an error."}
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="w-fit gap-1.5"
								onClick={() => {
									clearError();
									regenerate();
								}}
							>
								<RotateCcwIcon className="size-3.5" />
								Retry
							</Button>
						</div>
					</div>
				) : null}

				<div className="shrink-0 p-3">
					<AgentChatComposer />
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
