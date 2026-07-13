"use client";

import type { ProjectDetail } from "@video-platform-challenge/api";

import { HistoryPanel } from "@/feature/studio/components/history-panel";
import { LeftPanel } from "@/feature/studio/components/left-panel";
import { PlayerCanvas } from "@/feature/studio/components/player-canvas";
import { StudioTopbar } from "@/feature/studio/components/studio-topbar";
import { TimelineStrip } from "@/feature/studio/components/timeline-strip";
import { ProjectAssetUrlsProvider } from "@/feature/studio/hooks/http/use-project-asset-urls";
import { useFirstRunToast } from "@/feature/studio/hooks/use-first-run-toast";
import { RenderExportProvider } from "@/feature/studio/hooks/use-render-export";
import { DraftStoreProvider } from "@/feature/studio/stores/draft-store-provider";
import { PlayerRefProvider } from "@/feature/studio/stores/player-ref-context";

/**
 * Studio shell layout (docs/studio-ui.md §1 diagram): topbar, left
 * Assets & Scenes panel / center Player / right History, timeline spanning
 * the full bottom width. The Agent has no floating dock here
 * (docs/studio-design-language.md §3d "consolidate the agent chat to the
 * right rail only") — it lives exclusively in `AgentChatSidebar`, a
 * persistent sidebar mounted by this route's `layout.tsx` as a sibling of
 * this view, opened from the rail's own `SidebarTrigger` or ⌘J. `AIDock`/
 * `AIDockInput` stay reserved for the Dashboard create composer.
 *
 * Generation is NON-blocking (RT-2, docs realtime-and-render-lock-v1.md §2):
 * the whole shell stays interactive while a project generates — the "you're
 * generating your episode" state lives INSIDE `PlayerCanvas` (its own content
 * while it has nothing to play), scene cards fill the timeline progressively,
 * and `useFirstRunToast` celebrates the first generation completing. No
 * overlay ever traps the user.
 */
function StudioViewInner() {
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
				<div className="flex h-svh min-h-0 flex-col gap-3 p-3">
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
			<ProjectAssetUrlsProvider projectId={projectId}>
				<StudioViewInner />
			</ProjectAssetUrlsProvider>
		</DraftStoreProvider>
	);
}
