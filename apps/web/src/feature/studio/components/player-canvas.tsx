"use client";

import { Player } from "@remotion/player";
import { ClapperboardIcon } from "lucide-react";
import { useMemo } from "react";

import { PlayerControls } from "@/feature/studio/components/player-controls";
import { PlayerGeneratingState } from "@/feature/studio/components/player-generating-state";
import {
	isFirstGeneration,
	isFirstGenerationFailure,
} from "@/feature/studio/lib/first-run";
import { COMPOSITION_REFERENCE_DIMENSIONS } from "@/feature/studio/lib/subtitle-canvas";
import {
	STUDIO_FPS,
	StudioComposition,
	timelineDurationInFrames,
} from "@/feature/studio/remotion/composition";
import { usePlayerRefContext } from "@/feature/studio/stores/player-ref-context";
import { useStudio } from "@/feature/studio/stores/use-studio";
import { cn } from "@/libs/utils";

/**
 * Center canvas (docs/studio-ui.md §1): `@remotion/player` playing the draft
 * timeline. Player dimensions follow the project's aspect ratio; vertical
 * projects letterbox naturally since the Player fits `compositionWidth`/
 * `compositionHeight` inside the given `style` box while preserving aspect
 * ratio.
 *
 * Non-blocking first-run (RT-2, docs realtime-and-render-lock-v1.md §2):
 * while a project's first-ever generation has nothing to play yet
 * (`isFirstGeneration`) — or failed before any scene landed
 * (`isFirstGenerationFailure`) — the canvas shows `PlayerGeneratingState`
 * instead of the black/empty box. This is the player's own content, NOT an
 * overlay: the rest of the Studio stays fully interactive throughout. As soon
 * as one scene reaches `video_ready` the predicate flips and the real `Player`
 * takes over (ready clips + per-scene placeholders).
 *
 * Full-glass generating surface (issue #2, docs/studio-fixes-backlog.md §2 —
 * "full glass en el bg, todo el player"): THIS component owns the WHETHER and
 * swaps the well's own background from the opaque `bg-black/60` player
 * backdrop to the `glass-composer` material while generating/failed, with no
 * padding gap — the well itself becomes the glass field edge-to-edge.
 * `PlayerGeneratingState` only renders the centered loader/label (or the
 * failure/Retry) on top of it; there is no second nested card.
 *
 * A 0-scene project never mounts the `Player`: `timelineDurationInFrames`
 * clamps to 1 for an empty timeline, so Remotion's own seek-bar math
 * (`frame / (durationInFrames - 1)`) divides by zero and logs "NaN is an
 * invalid value for width". Nothing is actually playable with zero scenes
 * either way, so the empty state below (same dashed-border language as
 * `timeline-strip.tsx`'s own empty state) stands in instead.
 *
 * On-theme controls (docs/studio-quality-pass.md §5): the Player mounts with
 * no `controls` prop — `PlayerControls` is a custom transport bar floated
 * over the canvas instead of Remotion's default chrome, driven through the
 * same `PlayerRef` the timeline already shares (`player-ref-context.tsx`).
 */
export function PlayerCanvas() {
	const { project, timeline, scenesById, subtitleStyle } = useStudio();
	const { registerPlayer } = usePlayerRefContext();
	const { width, height } =
		COMPOSITION_REFERENCE_DIMENSIONS[project.aspectRatio];
	const durationInFrames = useMemo(
		() => timelineDurationInFrames(timeline, STUDIO_FPS),
		[timeline],
	);
	const totalSeconds = useMemo(
		() => timeline.reduce((total, entry) => total + entry.durationSeconds, 0),
		[timeline],
	);

	const scenes = useMemo(() => Object.values(scenesById), [scenesById]);
	const isGenerating = isFirstGeneration(project, scenes);
	const isFailed = isFirstGenerationFailure(project, scenes);
	const isGeneratingSurface = isGenerating || isFailed;

	return (
		<div
			className={cn(
				"surface-panel flex h-full min-h-0 items-center justify-center",
				isGeneratingSurface ? "glass-composer" : "bg-black/60 p-4",
			)}
		>
			{isGeneratingSurface ? (
				<PlayerGeneratingState isFailed={isFailed} />
			) : timeline.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 border-dashed px-8 py-6 text-muted-foreground text-sm">
					<ClapperboardIcon className="size-6" />
					No scenes yet — add one to start previewing.
				</div>
			) : (
				<div className="relative h-full w-full">
					<Player
						ref={registerPlayer}
						component={StudioComposition}
						inputProps={{ scenesById, subtitleStyle, timeline }}
						durationInFrames={durationInFrames}
						fps={STUDIO_FPS}
						compositionWidth={width}
						compositionHeight={height}
						style={{ height: "100%", width: "100%" }}
						loop
						acknowledgeRemotionLicense
						className="overflow-hidden rounded-xl"
					/>
					<PlayerControls
						totalSeconds={totalSeconds}
						className="absolute inset-x-3 bottom-3"
					/>
				</div>
			)}
		</div>
	);
}
