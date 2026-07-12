"use client";

import { Player } from "@remotion/player";
import { ClapperboardIcon } from "lucide-react";
import { useMemo } from "react";

import { COMPOSITION_REFERENCE_DIMENSIONS } from "@/feature/studio/lib/subtitle-canvas";
import {
	STUDIO_FPS,
	StudioComposition,
	timelineDurationInFrames,
} from "@/feature/studio/remotion/composition";
import { usePlayerRefContext } from "@/feature/studio/stores/player-ref-context";
import { useStudio } from "@/feature/studio/stores/use-studio";

/**
 * Center canvas (docs/studio-ui.md §1): `@remotion/player` playing the draft
 * timeline. Player dimensions follow the project's aspect ratio; vertical
 * projects letterbox naturally since the Player fits `compositionWidth`/
 * `compositionHeight` inside the given `style` box while preserving aspect
 * ratio.
 *
 * A 0-scene project never mounts the `Player`: `timelineDurationInFrames`
 * clamps to 1 for an empty timeline, so Remotion's own seek-bar math
 * (`frame / (durationInFrames - 1)`) divides by zero and logs "NaN is an
 * invalid value for width". Nothing is actually playable with zero scenes
 * either way, so the empty state below (same dashed-border language as
 * `timeline-strip.tsx`'s own empty state) stands in instead.
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

	return (
		<div className="surface-panel flex h-full min-h-0 items-center justify-center bg-black/60 p-4">
			{timeline.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 border-dashed px-8 py-6 text-muted-foreground text-sm">
					<ClapperboardIcon className="size-6" />
					No scenes yet — add one to start previewing.
				</div>
			) : (
				<Player
					ref={registerPlayer}
					component={StudioComposition}
					inputProps={{ scenesById, subtitleStyle, timeline }}
					durationInFrames={durationInFrames}
					fps={STUDIO_FPS}
					compositionWidth={width}
					compositionHeight={height}
					style={{ height: "100%", width: "100%" }}
					controls
					loop
					className="overflow-hidden rounded-xl"
				/>
			)}
		</div>
	);
}
