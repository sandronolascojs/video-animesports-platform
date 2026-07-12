"use client";

import { ProjectStatus, SceneStatus } from "@video-platform-challenge/types";
import {
	AlertTriangleIcon,
	ArrowLeftIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
	XIcon,
} from "lucide-react";
import Link from "next/link";

import { MainButton } from "@/components/kit/main-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { isProjectActive } from "@/feature/studio/hooks/http/use-project";
import {
	renderButtonLabel,
	useRenderExport,
} from "@/feature/studio/hooks/use-render-export";
import { useStudioChat } from "@/feature/studio/stores/studio-chat-provider";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { cn } from "@/libs/utils";

const STATUS_LABEL: Record<string, string> = {
	[ProjectStatus.ASSEMBLING]: "Assembling",
	[ProjectStatus.DRAFT]: "Draft",
	[ProjectStatus.FAILED]: "Failed",
	[ProjectStatus.GENERATING]: "Generating",
	[ProjectStatus.PLANNING]: "Planning",
	[ProjectStatus.READY]: "Ready",
	[ProjectStatus.STORYBOARD]: "Building storyboard",
};

/**
 * Topbar (docs/studio-design-language.md §3e): back, title, status badge,
 * the Director toggle, Export. Export drives the same `useRenderExport`
 * state machine as the timeline's Render button (front-wiring phase 3, SCOPE
 * item 3's "unify") — disabled while a render is running or until every
 * scene is `video_ready`. Status reads the project row directly
 * (server-authoritative — docs' generating-state machine) rather than being
 * re-derived from scene statuses; a project-level `failReason` (docs
 * "error-first: the product must always load and render failures
 * beautifully") surfaces as a banner right below the bar.
 *
 * The Director toggle (§3d "open affordance moves to the Studio topbar") is
 * this route's only way to open `AgentChatSidebar` now that the floating
 * dock is gone — ⌘J (registered in `StudioChatProvider`) does the same.
 */
export function StudioTopbar() {
	const { project, orderedScenes } = useStudio();
	const { canRender, cancel, isRunning, start, state } = useRenderExport();
	const {
		isOpen: isChatOpen,
		open: openChat,
		close: closeChat,
	} = useStudioChat();

	const hasFailedScene = orderedScenes.some(
		({ scene }) => scene.status === SceneStatus.FAILED,
	);
	const isActive = isProjectActive(project);
	const statusVariant =
		project.status === ProjectStatus.FAILED
			? "destructive"
			: isActive
				? "default"
				: hasFailedScene
					? "destructive"
					: "secondary";

	// Ambient "it's working" cue now that generation is non-blocking (RT-2):
	// while the project is actively generating (first-run OR extend) the pill
	// counts finished scenes, e.g. "Generating · 2/3". Falls back to the plain
	// status label ("Planning", "Ready", …) when idle, or before any scene
	// exists (planning phase) where a 0/0 count would read as noise.
	const totalScenes = orderedScenes.length;
	const readyScenes = orderedScenes.filter(
		({ scene }) => scene.status === SceneStatus.VIDEO_READY,
	).length;
	const isGenerating = isActive && totalScenes > 0;
	const statusLabel = isGenerating
		? `Generating · ${readyScenes}/${totalScenes}`
		: (STATUS_LABEL[project.status] ?? project.status);

	return (
		<div className="flex flex-col gap-2">
			<div className="surface-panel flex items-center gap-3 px-3 py-2.5">
				<Button asChild variant="ghost" size="icon-sm">
					<Link href="/">
						<ArrowLeftIcon />
						<span className="sr-only">Back to Home</span>
					</Link>
				</Button>

				<h1 className="min-w-0 flex-1 truncate font-semibold text-sm">
					{project.title ?? "Untitled project"}
				</h1>

				<Badge
					variant={statusVariant}
					className={cn(isGenerating && "tabular-nums")}
				>
					{statusLabel}
				</Badge>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="gap-1.5"
							aria-expanded={isChatOpen}
							aria-label={
								isChatOpen ? "Close Director chat" : "Open Director chat"
							}
							onClick={() => (isChatOpen ? closeChat() : openChat())}
						>
							{isChatOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
							Director
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{isChatOpen ? "Close" : "Open"} Director chat · ⌘J
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<span>
							<MainButton
								type="button"
								size="sm"
								disabled={isRunning || !canRender}
								onClick={start}
							>
								{renderButtonLabel(state, "Export")}
							</MainButton>
						</span>
					</TooltipTrigger>
					{!canRender ? (
						<TooltipContent>All scenes must finish generating</TooltipContent>
					) : null}
				</Tooltip>

				{isRunning ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Cancel export"
								onClick={cancel}
							>
								<XIcon />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Cancel export</TooltipContent>
					</Tooltip>
				) : null}
			</div>

			{project.failReason ? (
				<div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
					<AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
					<p className="text-destructive text-xs">{project.failReason}</p>
				</div>
			) : null}
		</div>
	);
}
