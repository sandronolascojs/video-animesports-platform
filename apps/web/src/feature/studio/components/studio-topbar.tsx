"use client";

import { ProjectStatus } from "@video-platform-challenge/types";
import { AlertTriangleIcon, ArrowLeftIcon, XIcon } from "lucide-react";
import Link from "next/link";

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
import { useStudio } from "@/feature/studio/stores/use-studio";

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
 * Topbar (docs/studio-ui.md §1 diagram): back, title, status badge, Export.
 * Export drives the same `useRenderExport` state machine as the timeline's
 * Render button (front-wiring phase 3, SCOPE item 3's "unify") — disabled
 * while a render is running or until every scene is `video_ready`. Status
 * reads the project row directly (server-authoritative — docs'
 * generating-state machine) rather than being re-derived from scene
 * statuses; a project-level `failReason` (docs "error-first: the product
 * must always load and render failures beautifully") surfaces as a banner
 * right below the bar.
 */
export function StudioTopbar() {
	const { project, orderedScenes } = useStudio();
	const { canRender, cancel, isRunning, start, state } = useRenderExport();

	const hasFailedScene = orderedScenes.some(
		({ scene }) => scene.status === "failed",
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

				<Badge variant={statusVariant}>
					{STATUS_LABEL[project.status] ?? project.status}
				</Badge>

				<Tooltip>
					<TooltipTrigger asChild>
						<span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isRunning || !canRender}
								onClick={start}
							>
								{renderButtonLabel(state, "Export")}
							</Button>
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
