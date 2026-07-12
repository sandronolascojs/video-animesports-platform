"use client";

import type { Scene } from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";
import {
	AlertTriangleIcon,
	FilmIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAssetUrl } from "@/feature/studio/hooks/http/use-asset-url";
import {
	isProjectActive,
	useExtendProject,
} from "@/feature/studio/hooks/http/use-project";
import {
	useRemoveScene,
	useRetryScene,
} from "@/feature/studio/hooks/http/use-scenes";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { useDialog } from "@/libs/dialogs/use-dialog";
import { toast } from "@/libs/toast";
import { cn } from "@/libs/utils";

const STATUS_LABEL: Record<Scene["status"], string> = {
	failed: "Failed",
	keyframe_pending: "Generating keyframes…",
	keyframe_ready: "Keyframes ready",
	planned: "Planned",
	video_pending: "Generating video…",
	video_ready: "Ready",
};

// The header lines up thumbnail (w-16) + gap-3 (0.75rem) = 4.75rem before the
// title column starts — everything rendered below a row (status line, failed
// reason, the editor) indents to that same column so it reads as nested
// under the row's title, not a separate block.
const ROW_INDENT = "pl-[4.75rem]";

// Zero-bounce spring for the inline editor reveal (emil-design-eng /
// show-more.tsx precedent) — crisp, no elastic overshoot.
const EDITOR_SPRING = { type: "spring", duration: 0.35, bounce: 0 } as const;

/** Keyframe preview — resolves a signed URL for `scene.startKeyframeAssetId` and falls back to a skeleton while it loads or isn't set yet. */
function SceneThumbnail({
	assetId,
	alt,
}: {
	assetId: string | null;
	alt: string;
}) {
	const { data, isLoading } = useAssetUrl(assetId);

	if (!assetId || isLoading || !data) {
		return <Skeleton className="h-11 w-16 rounded-lg" />;
	}

	return (
		// biome-ignore lint/performance/noImgElement: signed R2 URLs are short-lived and per-asset — next/image's remote-loader allowlist doesn't fit this.
		<img
			src={data.url}
			alt={alt}
			className="h-11 w-16 rounded-lg object-cover"
		/>
	);
}

/**
 * One scene row — flat, no per-item card (docs/studio-design-language.md
 * §3a). Compact by default: thumbnail + title + a quiet status line, with
 * delete/retry revealed on hover/focus. Selecting the row (click, or the
 * matching timeline clip via the shared `selectedSceneId`) fills it with
 * `bg-accent` and, for a `video_ready` scene, expands the prompt/dialogue/
 * subtitle editor inline underneath — never a nested card.
 */
function SceneRow({ scene, projectId }: { scene: Scene; projectId: string }) {
	const { updateSceneField, removeSceneLocal, selectedSceneId, selectScene } =
		useStudio();
	const { open: openDialog } = useDialog();
	const retryScene = useRetryScene(projectId);
	const removeScene = useRemoveScene(projectId);
	const reduceMotion = useReducedMotion();
	const isSelected = selectedSceneId === scene.id;

	const isGenerating =
		scene.status === SceneStatus.PLANNED ||
		scene.status === SceneStatus.KEYFRAME_PENDING ||
		scene.status === SceneStatus.KEYFRAME_READY ||
		scene.status === SceneStatus.VIDEO_PENDING;
	const hasKeyframePreview =
		scene.status === SceneStatus.KEYFRAME_READY ||
		scene.status === SceneStatus.VIDEO_PENDING ||
		scene.status === SceneStatus.VIDEO_READY;
	const isFailed = scene.status === SceneStatus.FAILED;
	const showEditor = isSelected && scene.status === SceneStatus.VIDEO_READY;

	const handleRetry = () => {
		retryScene.mutate(
			{ id: scene.id },
			{
				onSuccess: () => {
					toast.info({
						description: "Generation restarted for this scene.",
						icon: <RotateCcwIcon className="size-4" />,
						title: `Retrying "${scene.title ?? "scene"}"`,
					});
				},
			},
		);
	};

	const handleDelete = () => {
		openDialog("delete-scene", {
			onConfirm: () => {
				removeScene.mutate(
					{ id: scene.id },
					{
						// Batch C fix 5: the success toast moved HERE (from the
						// dialog's synchronous onClick) — this fires only once
						// the mutation actually resolves, so it can never show
						// alongside `useRemoveScene`'s onError toast for the
						// same delete.
						onSuccess: (result) => {
							removeSceneLocal(scene.id, result.timeline);
							toast.success({
								title: `Deleted "${scene.title ?? "Untitled scene"}"`,
								description: "The scene was removed from the timeline.",
								icon: <Trash2Icon className="size-4" />,
							});
						},
					},
				);
			},
			sceneId: scene.id,
			title: scene.title ?? "Untitled scene",
		});
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: click-to-select mirrors the timeline clip — a pointer convenience layered over the row's own focusable controls (inputs, buttons, textareas), not a new interactive element of its own.
		<div
			onClick={() => selectScene(scene.id)}
			className={cn(
				"group flex flex-col gap-1.5 px-2 py-2 transition-colors duration-150 ease-out",
				isSelected ? "bg-accent" : "hover:bg-accent/40",
			)}
		>
			<div className="flex items-center gap-3">
				<span
					aria-hidden
					className="h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-muted"
				>
					{hasKeyframePreview ? (
						<SceneThumbnail
							assetId={scene.startKeyframeAssetId}
							alt={scene.title ?? "Scene keyframe"}
						/>
					) : null}
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{scene.title ?? "Untitled scene"}
					</p>
					{scene.status === SceneStatus.VIDEO_READY ? null : (
						<p
							className={cn(
								"truncate text-xs",
								isFailed ? "text-destructive" : "text-muted-foreground",
							)}
						>
							{STATUS_LABEL[scene.status]}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
					{isFailed ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							disabled={retryScene.isPending}
							className="text-muted-foreground hover:text-foreground"
							onClick={(event) => {
								event.stopPropagation();
								handleRetry();
							}}
						>
							<RotateCcwIcon className="size-3.5" />
							<span className="sr-only">Retry scene</span>
						</Button>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground hover:text-destructive"
						onClick={(event) => {
							event.stopPropagation();
							handleDelete();
						}}
					>
						<Trash2Icon className="size-3.5" />
						<span className="sr-only">Delete scene</span>
					</Button>
				</div>
			</div>

			{isGenerating ? (
				<div className={ROW_INDENT}>
					<Progress value={undefined} className="h-1 animate-pulse" />
				</div>
			) : null}

			{isFailed ? (
				<div className={cn("flex items-start gap-2", ROW_INDENT)}>
					<AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
					<p className="min-w-0 flex-1 text-destructive text-xs">
						{scene.failReason ?? "Generation failed."}
					</p>
					<Button
						type="button"
						size="xs"
						variant="outline"
						disabled={retryScene.isPending}
						onClick={(event) => {
							event.stopPropagation();
							handleRetry();
						}}
						className="shrink-0 gap-1"
					>
						<RotateCcwIcon className="size-3" />
						Retry
					</Button>
				</div>
			) : null}

			<AnimatePresence initial={false}>
				{showEditor ? (
					<motion.div
						key="editor"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={reduceMotion ? { duration: 0 } : EDITOR_SPRING}
						className="overflow-hidden"
					>
						<div className={cn("flex flex-col gap-2 pt-1.5", ROW_INDENT)}>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor={`${scene.id}-prompt`}
									className="text-muted-foreground text-xs"
								>
									Prompt
								</Label>
								<Textarea
									id={`${scene.id}-prompt`}
									value={scene.prompt}
									onChange={(event) =>
										updateSceneField(scene.id, "prompt", event.target.value)
									}
									className="min-h-16 text-xs"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor={`${scene.id}-dialogue`}
									className="text-muted-foreground text-xs"
								>
									Dialogue
								</Label>
								<Textarea
									id={`${scene.id}-dialogue`}
									value={scene.dialogue ?? ""}
									onChange={(event) =>
										updateSceneField(scene.id, "dialogue", event.target.value)
									}
									className="min-h-10 text-xs"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor={`${scene.id}-subtitle`}
									className="text-muted-foreground text-xs"
								>
									Subtitle
								</Label>
								<Textarea
									id={`${scene.id}-subtitle`}
									value={scene.subtitleText ?? ""}
									onChange={(event) =>
										updateSceneField(
											scene.id,
											"subtitleText",
											event.target.value,
										)
									}
									className="min-h-10 text-xs"
								/>
							</div>
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/**
 * Scenes tab (docs/studio-design-language.md §3a): one flat surface — a
 * list of compact rows separated by hairline dividers, not bordered
 * scene cards. Selecting a row is the only way to expand its editor; the
 * manual counterpart of the future agent's tools — same services behind
 * both.
 */
export function ScenesPanel() {
	const { orderedScenes, project, projectId } = useStudio();
	const extendProject = useExtendProject(projectId);
	const busy = isProjectActive(project) || extendProject.isPending;

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<div className="min-h-0 flex-1 overflow-y-auto pr-1">
				{orderedScenes.length === 0 ? (
					<Empty className="h-full border-none p-6">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FilmIcon />
							</EmptyMedia>
							<EmptyTitle>No scenes yet</EmptyTitle>
							<EmptyDescription>
								Add a scene to start building the timeline.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<div className="divide-y divide-border/50">
						{orderedScenes.map(({ scene }) => (
							<SceneRow key={scene.id} scene={scene} projectId={projectId} />
						))}
					</div>
				)}
			</div>
			<Button
				type="button"
				variant="outline"
				disabled={busy}
				title={busy ? "This project is already generating." : undefined}
				onClick={() => extendProject.mutate({ id: projectId })}
				className="gap-1.5"
			>
				<PlusIcon className="size-4" />
				Add scene
			</Button>
		</div>
	);
}
