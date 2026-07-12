"use client";

import type { ProjectDetail } from "@video-platform-challenge/api";
import { AnimatePresence } from "motion/react";

import { FirstRunOverlay } from "@/feature/studio/components/first-run-overlay";
import { HistoryPanel } from "@/feature/studio/components/history-panel";
import { LeftPanel } from "@/feature/studio/components/left-panel";
import { PlayerCanvas } from "@/feature/studio/components/player-canvas";
import { StudioDock } from "@/feature/studio/components/studio-dock";
import { StudioTopbar } from "@/feature/studio/components/studio-topbar";
import { TimelineStrip } from "@/feature/studio/components/timeline-strip";
import { RenderExportProvider } from "@/feature/studio/hooks/use-render-export";
import {
	isFirstGeneration,
	isFirstGenerationFailure,
} from "@/feature/studio/lib/first-run";
import { DraftStoreProvider } from "@/feature/studio/stores/draft-store-provider";
import { PlayerRefProvider } from "@/feature/studio/stores/player-ref-context";
import { useStudioChat } from "@/feature/studio/stores/studio-chat-provider";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { cn } from "@/libs/utils";

/**
 * Studio shell layout (docs/studio-ui.md §1 diagram): topbar, left
 * Assets & Scenes panel / center Player / right History, timeline spanning
 * the full bottom width, AIDock floating bottom-center above all of it
 * (the agent dock — v1 wires the demo status-bar choreography only; the
 * real ToolLoopAgent lands in v3).
 */
function StudioViewInner({ projectId }: { projectId: string }) {
	// Dock↔sidebar exclusivity (docs/ai-architecture-v1.md §2 "Dock ↔
	// sidebar: two views of ONE chat" — never both visible): the floating
	// AIDock only renders while `AgentChatSidebar` (mounted by this route's
	// `layout.tsx`, a sibling of this view) is closed.
	const { isOpen: isChatOpen } = useStudioChat();

	// RT-2 (docs realtime-and-render-lock-v1.md §2): blocks the editor
	// region behind a frosted overlay ONLY for a project's first-ever
	// generation (never extend/retry — see lib/first-run.ts's doc comments).
	// Computed here (not just inside `FirstRunOverlay`) because the editor
	// region's own `aria-hidden`/`pointer-events-none` gating below must stay
	// in lockstep with whether the overlay is actually mounted.
	const { project, scenesById } = useStudio();
	const scenes = Object.values(scenesById);
	const showFirstRunOverlay =
		isFirstGeneration(project, scenes) ||
		isFirstGenerationFailure(project, scenes);

	return (
		// `h-[calc(100svh-1rem)]` (not `h-full`): the shared `(private)` shell
		// is `min-h-svh` (docs/studio-ui.md "Layout sizing rule"), so it has no
		// fixed height for a percentage-based `h-full` to resolve against.
		// Studio needs a firm viewport anchor for its internal panels to scroll
		// instead of growing the page — `svh` is a viewport unit, not a
		// percentage, so it works regardless of ancestor height. The `-1rem`
		// accounts for `SidebarInset`'s `my-2` (0.5rem top + 0.5rem bottom).
		//
		// `PlayerRefProvider` wraps `PlayerCanvas` (mounts the Player, registers
		// the ref) and `TimelineStrip` (reads/drives it for scrub + playhead
		// sync) — the smallest clean mechanism to share the imperative
		// `PlayerRef` between the two siblings (see player-ref-context.tsx).
		<PlayerRefProvider>
			<RenderExportProvider>
				<div className="relative flex h-svh min-h-0 flex-col gap-3 p-3">
					<StudioTopbar />
					{/* The blocked "editor region" (RT-2 §2): grid + timeline only —
					    the topbar above and the AI dock below both stay interactive
					    ("Back to home", chatting mid-generation). `relative` anchors
					    `FirstRunOverlay`'s `absolute inset-0`; `aria-hidden` +
					    `pointer-events-none` block the region for a11y and pointer
					    input while it stays fully visible and animating underneath
					    the glass. */}
					<div className="relative flex min-h-0 flex-1 flex-col gap-3">
						<div
							aria-hidden={showFirstRunOverlay || undefined}
							className={cn(
								"grid min-h-0 flex-1 grid-cols-[20rem_1fr_18rem] gap-3",
								showFirstRunOverlay && "pointer-events-none",
							)}
						>
							<LeftPanel />
							<PlayerCanvas />
							<HistoryPanel />
						</div>
						<div
							aria-hidden={showFirstRunOverlay || undefined}
							className={cn(
								"h-52 shrink-0",
								showFirstRunOverlay && "pointer-events-none",
							)}
						>
							<TimelineStrip />
						</div>
						{showFirstRunOverlay ? <FirstRunOverlay /> : null}
					</div>
					{/* `AnimatePresence` (not a bare conditional) so the dock's own
					    `exit` transition (`ai-dock.tsx`) plays when `AgentChatSidebar`
					    opens, instead of popping out instantly — the two surfaces read
					    as one fluid handoff, not an abrupt swap. */}
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
