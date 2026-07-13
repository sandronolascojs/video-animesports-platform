"use client";

import { ProjectStatus, SceneStatus } from "@video-platform-challenge/types";
import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { MainButton } from "@/components/kit/main-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { isProjectActive } from "@/feature/studio/hooks/http/use-project";
import { useRenderExport } from "@/feature/studio/hooks/use-render-export";
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
 * Export. Export drives the same `useRenderExport` state machine as the
 * timeline's Render button (front-wiring phase 3, SCOPE item 3's "unify") —
 * disabled while a render is running or until every scene is `video_ready`.
 * Status reads the project row directly (server-authoritative — docs'
 * generating-state machine) rather than being re-derived from scene
 * statuses; a project-level `failReason` (docs "error-first: the product
 * must always load and render failures beautifully") surfaces as a banner
 * right below the bar.
 *
 * The Agent chat toggle used to live here — it now lives in
 * `AgentChatSidebar`'s own header (`SidebarTrigger`), since that rail is a
 * persistent `components/ui/sidebar.tsx` sidebar with its own open/close
 * control, not a panel this topbar needs to drive. ⌘J (registered in
 * `StudioChatProvider`) still opens/closes it from anywhere in the Studio.
 */
export function StudioTopbar() {
	const { project, orderedScenes } = useStudio();
	const { canRender, isRunning, start } = useRenderExport();

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
						<span>
							<MainButton
								type="button"
								size="sm"
								disabled={isRunning || !canRender}
								onClick={start}
							>
								{isRunning ? (
									<>
										<Spinner className="size-4" />
										<span className="sr-only">Exporting…</span>
									</>
								) : (
									"Export"
								)}
							</MainButton>
						</span>
					</TooltipTrigger>
					{!canRender ? (
						<TooltipContent>All scenes must finish generating</TooltipContent>
					) : null}
				</Tooltip>
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
