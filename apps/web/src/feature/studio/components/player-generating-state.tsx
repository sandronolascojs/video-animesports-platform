"use client";

import { SceneStatus } from "@video-platform-challenge/types";
import { RotateCcwIcon } from "lucide-react";
import { GridLoaderPill } from "@/components/app/grid-loader-pill";
import { Button } from "@/components/ui/button";
import type { PresetPattern } from "@/components/ui/grid-loader";
import { WordRotate } from "@/components/ui/word-rotate";
import { useRetryScene } from "@/feature/studio/hooks/http/use-scenes";
import {
	describeFirstRunStatus,
	type FirstRunPhase,
	getFirstRunPhase,
} from "@/feature/studio/lib/first-run";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { toast } from "@/libs/toast";

// GridLoader sequence per generation phase (issue #3, docs/studio-fixes-
// backlog.md §3): a thinking/generating/rendering-style mapping so the mark
// morphs as the REAL phase advances (`getFirstRunPhase`) instead of looping
// decoratively. One entry per `FirstRunPhase` — never invent a bucket here
// that phase doesn't have.
const PLANNING_SEQUENCE: PresetPattern[] = [
	"breathing",
	"ripple-in",
	"solo-center",
	"ripple-in",
];

const KEYFRAME_SEQUENCE: PresetPattern[] = [
	"ripple-in",
	"plus-full",
	"frame",
	"x-shape",
];

const RENDERING_SEQUENCE: PresetPattern[] = [
	"wave-lr",
	"wave-rl",
	"spiral-cw",
	"snake",
];

const PHASE_SEQUENCE: Record<FirstRunPhase, PresetPattern[]> = {
	keyframes: KEYFRAME_SEQUENCE,
	planning: PLANNING_SEQUENCE,
	rendering: RENDERING_SEQUENCE,
};

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
 * first clip play while the rest keep filling in.
 *
 * `player-canvas.tsx` owns the WHETHER and the full-bleed `glass-composer`
 * surface itself (issue #2); this component renders only the centered
 * content directly on that glass — no nested card/plate, so generating and
 * failure both read as the player itself, not a box inside a box.
 *
 * The loader (issue #3): ONE small `GridLoaderPill` (a compact GridLoader mark
 * + the live label on a black chip — the app's shared professional loading
 * affordance, same pill the Agent chat uses) whose pattern sequence is picked
 * by the live phase (`getFirstRunPhase`) and remounted (`key={phase}`) on every
 * phase change so the mark and the `WordRotate` label switch together — a
 * thinking/generating/rendering-style cycle tied to the REAL phase, never a
 * decorative loop disconnected from it. The label itself is driven straight
 * off `describeFirstRunStatus`'s live string: `WordRotate` crossfades
 * whenever that string changes (a new scene starts rendering, a new phase
 * begins) and holds otherwise — no faked progress.
 * `prefers-reduced-motion` is honored by both `GridLoader` and `WordRotate`.
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
				className="flex flex-col items-center gap-5 px-8 py-9 text-center"
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

	const phase = getFirstRunPhase(project, scenes);

	return (
		<div
			className="flex flex-col items-center gap-5 px-8 py-9 text-center"
			role="status"
		>
			<GridLoaderPill
				key={phase}
				label={<WordRotate words={[describeFirstRunStatus(project, scenes)]} />}
				mode="sequence"
				sequence={PHASE_SEQUENCE[phase]}
			/>
			<p className="max-w-sm text-muted-foreground text-xs">
				Watch your episode come together in the timeline below.
			</p>
		</div>
	);
}
