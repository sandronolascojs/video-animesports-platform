"use client";

import { SceneStatus } from "@video-platform-challenge/types";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PresetPattern } from "@/components/ui/smoothui/grid-loader";
import { GridLoader } from "@/components/ui/smoothui/grid-loader";
import { useRetryScene } from "@/feature/studio/hooks/http/use-scenes";
import { describeFirstRunStatus } from "@/feature/studio/lib/first-run";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { toast } from "@/libs/toast";

// A tasteful "actively generating" cycle for the hero GridLoader: ripple
// gathering to center, a full plus, a hollow frame, an X — reads as
// continuous generative motion rather than a repeating spinner.
const GENERATING_SEQUENCE: PresetPattern[] = [
	"ripple-in",
	"plus-full",
	"frame",
	"x-shape",
];

export type PlayerGeneratingStateProps = {
	/** Whether the first generation ended in `failed` before any scene ever landed. */
	isFailed: boolean;
};

/**
 * The player's own content while a project's first-ever generation has
 * nothing to play yet (RT-2, docs realtime-and-render-lock-v1.md §2) — a
 * calm, NON-blocking generating state that stands in for the black/empty
 * canvas. Nothing here traps the user: every panel, the timeline, the dock,
 * the chat, and navigation stay fully interactive; the moment the first scene
 * lands (`video_ready`) `player-canvas.tsx` swaps this out for the real
 * `Player` (ready clips + per-scene placeholders) so the owner watches the
 * first clip play while the rest keep filling in. `player-canvas.tsx` owns
 * the WHETHER (via `isFirstGeneration`/`isFirstGenerationFailure`); this owns
 * only the WHAT. `prefers-reduced-motion` is honored by `GridLoader` itself.
 */
export function PlayerGeneratingState({
	isFailed,
}: PlayerGeneratingStateProps) {
	const { project, scenesById, projectId } = useStudio();
	const retryScene = useRetryScene(projectId);
	const scenes = Object.values(scenesById);

	if (isFailed) {
		const failedScene = scenes.find(
			(scene) => scene.status === SceneStatus.FAILED,
		);

		return (
			<div
				className="flex flex-col items-center gap-4 text-center"
				role="alert"
			>
				<p className="max-w-sm text-balance text-foreground text-sm">
					{project.failReason ?? "Generation failed before any scene finished."}
				</p>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!failedScene || retryScene.isPending}
					className="gap-1.5"
					onClick={() => {
						if (!failedScene) {
							return;
						}
						retryScene.mutate(
							{ id: failedScene.id },
							{
								onSuccess: () => {
									toast.info({
										description: "Generation restarted for this project.",
										icon: <RotateCcwIcon className="size-4" />,
										title: "Retrying",
									});
								},
							},
						);
					}}
				>
					<RotateCcwIcon className="size-3.5" />
					Retry
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-5 text-center" role="status">
			<GridLoader
				mode="sequence"
				sequence={GENERATING_SEQUENCE}
				color="amber"
				size={72}
				blur={2}
				speed="normal"
				rounded
			/>
			<div className="flex flex-col gap-1.5">
				<p className="font-medium text-foreground text-sm">
					{describeFirstRunStatus(project, scenes)}
				</p>
				<p className="text-muted-foreground text-xs">
					Watch your episode come together in the timeline below.
				</p>
			</div>
		</div>
	);
}
