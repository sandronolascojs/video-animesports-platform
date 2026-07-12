"use client";

import type { UIMessage } from "ai";
import {
	AlertTriangleIcon,
	ClapperboardIcon,
	RotateCcwIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import {
	Conversation,
	ConversationContent,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
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
import { AgentChatComposer } from "@/feature/studio/components/agent-chat-composer";
import { useStudioChat } from "@/feature/studio/stores/studio-chat-provider";
import { cn } from "@/libs/utils";

const MOUNT_TRANSITION = { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const };

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
 * bold title + one muted hint, then the starter rows — flat, hairline-divided
 * (`ScenesPanel`'s own `divide-y divide-border/50` convention, NOT a nested
 * card per surface), each a full-width tappable row.
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
					<ClapperboardIcon />
				</EmptyMedia>
				<EmptyTitle>Direct your episode</EmptyTitle>
				<EmptyDescription>
					Ask the Director to extend scenes, retry a shot, or render a new
					version.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<div className="w-full divide-y divide-border/50">
					{CHAT_SUGGESTIONS.map((suggestion) => (
						<button
							key={suggestion}
							type="button"
							onClick={() => onSuggestion(suggestion)}
							className="flex w-full items-center px-2 py-2.5 text-left text-muted-foreground text-sm transition-colors duration-150 ease-out hover:bg-accent/40 hover:text-foreground"
						>
							{suggestion}
						</button>
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
 * gone, this rail is it). Docks on the RIGHT at ~23rem: the original
 * `--sidebar-width` (16rem) + 20% = 19.2rem, widened another ~20% by this
 * pass for breathing room. Same floating card visual language as
 * `AppSidebar` (`surface-panel`: rounded-2xl, `border-sidebar-border`,
 * `bg-sidebar`) with the same `my-2 mr-2` spacing `SidebarInset` uses, so the
 * rail reads as a sibling of that card language even though the Studio route
 * never renders `AppSidebar` itself. The composer inside stays the shared
 * `AIDockInput` glass (`glass-composer`) — the rail's own material is
 * `surface-panel`, not stacked glass-on-glass (docs §2 "don't stack glass on
 * glass").
 *
 * Opened from `StudioTopbar`'s Director button or ⌘J (both wired through
 * `useStudioChat()`).
 *
 * AI-4: real messages from `useStudioChat()` (the shared `useChat` session
 * `StudioChatProvider` owns), rendered with the vendored `ai-elements`
 * primitives. `Conversation`/`ConversationContent` wrap `use-stick-to-bottom`
 * internally, so auto-scroll-to-bottom on new messages/streaming content is
 * free — no extra scroll wiring needed here.
 */
export function AgentChatSidebar() {
	const {
		isOpen,
		close,
		messages,
		error,
		regenerate,
		clearError,
		requestPrefill,
	} = useStudioChat();

	return (
		<AnimatePresence initial={false}>
			{isOpen ? (
				<motion.aside
					key="agent-chat-sidebar"
					initial={{ opacity: 0, width: 0 }}
					animate={{ opacity: 1, width: "23rem" }}
					exit={{ opacity: 0, width: 0 }}
					// `MOUNT_TRANSITION` is the same `[0.32, 0.72, 0, 1]` "drawer" ease
					// + 220ms duration the (now-removed) floating dock's own mount/exit
					// used — kept identical so the topbar toggle's open/close still
					// reads as one deliberate handoff, not an arbitrary animation.
					// Animating `width` (not just `transform`/`opacity`) is a deliberate
					// exception here: the editor sibling genuinely needs to reflow into
					// the reclaimed space when the rail closes (spec "when collapsed,
					// the editor takes the full width") — an occasional, user-initiated
					// open/close, not a high-frequency animation, so the extra layout
					// cost is acceptable.
					transition={MOUNT_TRANSITION}
					className="surface-panel my-2 mr-2 flex min-h-0 flex-col overflow-hidden"
				>
					{/* Fixed inner width: the OUTER `motion.aside` animates `width`
					    (0 → 23rem) with `overflow-hidden`, so this inner column stays
					    pinned at the rail's resting width and gets progressively
					    revealed/clipped as the wrapper animates — a wipe, not a squeeze. */}
					<div className="flex h-full min-h-0 w-[23rem] flex-col">
						<header className="flex shrink-0 items-center justify-between gap-2 border-sidebar-border border-b px-4 py-3">
							<div className="flex items-center gap-2">
								<ClapperboardIcon className="size-4 text-muted-foreground" />
								<h2 className="font-semibold text-sm">Director</h2>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={close}
								aria-label="Close Director chat"
							>
								<XIcon />
							</Button>
						</header>

						<div className={cn("flex min-h-0 flex-1 flex-col")}>
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
						</div>

						{error ? (
							<div className="shrink-0 border-sidebar-border border-t p-3 pb-0">
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

						<div className="shrink-0 border-sidebar-border border-t p-3">
							<AgentChatComposer />
						</div>
					</div>
				</motion.aside>
			) : null}
		</AnimatePresence>
	);
}
