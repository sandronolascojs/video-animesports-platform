"use client";

import type { Scene } from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";
import type { VariantProps } from "class-variance-authority";
import {
	AlertTriangleIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const STATUS_VARIANT: Record<
	Scene["status"],
	VariantProps<typeof badgeVariants>["variant"]
> = {
	failed: "destructive",
	keyframe_pending: "default",
	keyframe_ready: "default",
	planned: "secondary",
	video_pending: "default",
	video_ready: "secondary",
};

const STATUS_LABEL: Record<Scene["status"], string> = {
	failed: "Failed",
	keyframe_pending: "Generating keyframes…",
	keyframe_ready: "Keyframes ready",
	planned: "Planned",
	video_pending: "Generating video…",
	video_ready: "Ready",
};

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
		return <Skeleton className="h-16 w-full rounded-lg" />;
	}

	return (
		// biome-ignore lint/performance/noImgElement: signed R2 URLs are short-lived and per-asset — next/image's remote-loader allowlist doesn't fit this.
		<img
			src={data.url}
			alt={alt}
			className="h-16 w-full rounded-lg object-cover"
		/>
	);
}

function SceneRow({ scene, projectId }: { scene: Scene; projectId: string }) {
	const { updateSceneField, removeSceneLocal, selectedSceneId, selectScene } =
		useStudio();
	const { open: openDialog } = useDialog();
	const retryScene = useRetryScene(projectId);
	const removeScene = useRemoveScene(projectId);
	const isSelected = selectedSceneId === scene.id;

	const isGeneratingKeyframe =
		scene.status === SceneStatus.PLANNED ||
		scene.status === SceneStatus.KEYFRAME_PENDING;
	const hasKeyframePreview =
		scene.status === SceneStatus.KEYFRAME_READY ||
		scene.status === SceneStatus.VIDEO_PENDING ||
		scene.status === SceneStatus.VIDEO_READY;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: click-to-select mirrors the timeline clip — a pointer convenience layered over the row's own focusable controls (inputs, buttons, textareas), not a new interactive element of its own.
		<div
			onClick={() => selectScene(scene.id)}
			className={cn(
				"flex flex-col gap-3 rounded-xl border p-3 transition-colors duration-150 ease-out",
				isSelected
					? "border-primary/60 ring-1 ring-primary/40"
					: "border-border/60",
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
					<Badge variant={STATUS_VARIANT[scene.status]} className="mt-1">
						{STATUS_LABEL[scene.status]}
					</Badge>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="shrink-0 text-muted-foreground hover:text-destructive"
					onClick={(event) => {
						event.stopPropagation();
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
					}}
				>
					<Trash2Icon className="size-4" />
					<span className="sr-only">Delete scene</span>
				</Button>
			</div>

			{isGeneratingKeyframe ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-16 w-full rounded-lg" />
					<p className="text-muted-foreground text-xs">
						{STATUS_LABEL[scene.status]}
					</p>
				</div>
			) : scene.status === SceneStatus.FAILED ? (
				<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
					<div className="flex items-start gap-2">
						<AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
						<p className="text-destructive text-xs">
							{scene.failReason ?? "Generation failed."}
						</p>
					</div>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={retryScene.isPending}
						onClick={() => {
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
						}}
						className="w-fit gap-1.5"
					>
						<RotateCcwIcon className="size-3.5" />
						Retry
					</Button>
				</div>
			) : scene.status === SceneStatus.VIDEO_PENDING ||
				scene.status === SceneStatus.KEYFRAME_READY ? (
				<div className="flex flex-col gap-2">
					<Progress value={undefined} className="h-1.5 animate-pulse" />
					<p className="text-muted-foreground text-xs">
						{STATUS_LABEL[scene.status]}
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
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
								updateSceneField(scene.id, "subtitleText", event.target.value)
							}
							className="min-h-10 text-xs"
						/>
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Scenes tab (docs/studio-ui.md §1 "Assets & Scenes panel"): editable rows
 * bound to draft state, per-status generating/failed presentation, add/delete
 * scene. The manual counterpart of the future agent's tools — same services
 * behind both.
 */
export function ScenesPanel() {
	const { orderedScenes, project, projectId } = useStudio();
	const extendProject = useExtendProject(projectId);
	const busy = isProjectActive(project) || extendProject.isPending;

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
				{orderedScenes.length === 0 ? (
					<p className="px-1 text-muted-foreground text-xs">No scenes yet.</p>
				) : (
					orderedScenes.map(({ scene }) => (
						<SceneRow key={scene.id} scene={scene} projectId={projectId} />
					))
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
