"use client";

import { SceneStatus } from "@video-platform-challenge/types";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useRetryScene } from "@/feature/studio/hooks/http/use-scenes";
import {
	describeFirstRunStatus,
	isFirstGeneration,
	isFirstGenerationFailure,
} from "@/feature/studio/lib/first-run";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { toast } from "@/libs/toast";
import { cn } from "@/libs/utils";

/**
 * Frosted layer blocking the editor (RT-2, docs realtime-and-render-lock-v1
 * §2) for ONLY a project's first-ever generation — never extend/retry (see
 * `lib/first-run.ts`'s doc comments for why the predicates can't re-trigger
 * later). Renders `null` once the predicate lifts; `studio-view.tsx` is the
 * one deciding WHETHER to mount this (and gating the editor region's
 * `aria-hidden`/`pointer-events-none` alongside it) so both stay in sync off
 * the same source of truth.
 *
 * Same glass material as the AI composer (`glass-composer`, globals.css) —
 * deliberately translucent so the timeline + player keep animating visibly
 * underneath while interaction is blocked, instead of hiding them.
 */
export function FirstRunOverlay() {
	const { project, scenesById, projectId } = useStudio();
	const retryScene = useRetryScene(projectId);
	const scenes = Object.values(scenesById);

	const isActive = isFirstGeneration(project, scenes);
	const isFailed = isFirstGenerationFailure(project, scenes);

	if (!isActive && !isFailed) {
		return null;
	}

	const failedScene = scenes.find(
		(scene) => scene.status === SceneStatus.FAILED,
	);

	return (
		<div
			className="glass-composer absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-2xl p-6 text-center"
			role={isFailed ? "alert" : "status"}
		>
			{isFailed ? (
				<>
					<p className="max-w-sm text-balance text-foreground text-sm">
						{project.failReason ??
							"Generation failed before any scene finished."}
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
				</>
			) : (
				<>
					<p className="text-foreground text-sm">
						{describeFirstRunStatus(project, scenes)}
					</p>
					<Progress
						value={65}
						aria-hidden
						className={cn("w-56", "motion-safe:animate-pulse")}
					/>
				</>
			)}
		</div>
	);
}
