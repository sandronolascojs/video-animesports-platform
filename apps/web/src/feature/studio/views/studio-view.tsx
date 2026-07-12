"use client";

import type { ProjectDetail } from "@video-platform-challenge/api";
import { AnimatePresence } from "motion/react";

import { HistoryPanel } from "@/feature/studio/components/history-panel";
import { LeftPanel } from "@/feature/studio/components/left-panel";
import { PlayerCanvas } from "@/feature/studio/components/player-canvas";
import { StudioDock } from "@/feature/studio/components/studio-dock";
import { StudioTopbar } from "@/feature/studio/components/studio-topbar";
import { TimelineStrip } from "@/feature/studio/components/timeline-strip";
import { useFirstRunToast } from "@/feature/studio/hooks/use-first-run-toast";
import { RenderExportProvider } from "@/feature/studio/hooks/use-render-export";
import { DraftStoreProvider } from "@/feature/studio/stores/draft-store-provider";
import { PlayerRefProvider } from "@/feature/studio/stores/player-ref-context";
import { useStudioChat } from "@/feature/studio/stores/studio-chat-provider";

/**
 * Studio shell layout (docs/studio-ui.md §1 diagram): topbar, left
 * Assets & Scenes panel / center Player / right History, timeline spanning
 * the full bottom width, AIDock floating bottom-center above all of it
 * (the agent dock — v1 wires the demo status-bar choreography only; the
 * real ToolLoopAgent lands in v3).
 *
 * Generation is NON-blocking (RT-2, docs realtime-and-render-lock-v1.md §2):
 * the whole shell stays interactive while a project generates — the "you're
 * generating your episode" state lives INSIDE `PlayerCanvas` (its own content
 * while it has nothing to play), scene cards fill the timeline progressively,
 * and `useFirstRunToast` celebrates the first generation completing. No
 * overlay ever traps the user.
 */
function StudioViewInner({ projectId }: { projectId: string }) {
	// Dock↔sidebar exclusivity (docs/ai-architecture-v1.md §2 "Dock ↔
	// sidebar: two views of ONE chat" — never both visible): the floating
	// AIDock only renders while `AgentChatSidebar` (mounted by this route's
	// `layout.tsx`, a sibling of this view) is closed.
	const { isOpen: isChatOpen } = useStudioChat();

	// One-time "your episode is ready" toast when this project's FIRST
	// generation completes — the leave-and-return signal now that nothing
	// blocks. Extend/retry completions never fire it (see the hook).
	useFirstRunToast();

	return (
		// `h-svh` (not `h-full`): the shared `(private)` shell is `min-h-svh`
		// (docs/studio-ui.md "Layout sizing rule"), so it has no fixed height for
		// a percentage-based `h-full` to resolve against. Studio needs a firm
		// viewport anchor for its internal panels to scroll instead of growing
		// the page — `svh` is a viewport unit, not a percentage, so it works
		// regardless of ancestor height.
		//
		// `PlayerRefProvider` wraps `PlayerCanvas` (mounts the Player, registers
		// the ref) and `TimelineStrip` (reads/drives it for scrub + playhead
		// sync) — the smallest clean mechanism to share the imperative
		// `PlayerRef` between the two siblings (see player-ref-context.tsx).
		<PlayerRefProvider>
			<RenderExportProvider>
				{/* `relative` anchors the floating `StudioDock`'s `absolute inset-x-0
				    bottom-0` (see ai-dock.tsx) to the content area rather than the
				    viewport, so it stays symmetric with the in-page composer. */}
				<div className="relative flex h-svh min-h-0 flex-col gap-3 p-3">
					<StudioTopbar />
					<div className="relative flex min-h-0 flex-1 flex-col gap-3">
						<div className="grid min-h-0 flex-1 grid-cols-[20rem_1fr_18rem] gap-3">
							<LeftPanel />
							<PlayerCanvas />
							<HistoryPanel />
						</div>
						<div className="h-52 shrink-0">
							<TimelineStrip />
						</div>
					</div>
					{/* `AnimatePresence` (not a bare conditional) so the dock's own
					    `exit` transition (`ai-dock.tsx`) plays when `AgentChatSidebar`
					    opens, instead of popping out instantly — the two surfaces read
					    as one fluid handoff, not an abrupt swap. Hidden ONLY while the
					    chat sidebar is open (never during generation — the flow is
					    non-blocking and the dock stays usable throughout). */}
					<AnimatePresence>
						{isChatOpen ? null : (
							<StudioDock key="studio-dock" projectId={projectId} />
						)}
					</AnimatePresence>
				</div>
			</RenderExportProvider>
		</PlayerRefProvider>
	);
}

export type StudioViewProps = {
	projectId: string;
	initialDetail: ProjectDetail;
};

export function StudioView({ projectId, initialDetail }: StudioViewProps) {
	return (
		<DraftStoreProvider projectId={projectId} initialDetail={initialDetail}>
			<StudioViewInner projectId={projectId} />
		</DraftStoreProvider>
	);
}
