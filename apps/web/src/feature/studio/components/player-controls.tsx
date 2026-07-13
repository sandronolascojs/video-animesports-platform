"use client";

import {
	Maximize2Icon,
	Minimize2Icon,
	PauseIcon,
	PlayIcon,
	Volume2Icon,
	VolumeXIcon,
} from "lucide-react";

import { MainButton } from "@/components/kit/main-button";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { usePlayerFullscreen } from "@/feature/studio/hooks/use-player-fullscreen";
import { usePlayerPlayback } from "@/feature/studio/hooks/use-player-playback";
import { usePlayerVolume } from "@/feature/studio/hooks/use-player-volume";
import {
	formatTimecode,
	framesToSeconds,
	secondsToFrames,
} from "@/feature/studio/lib/time";
import { cn } from "@/libs/utils";

/** Ghost pill icon button — same recipe as the zoom controls in `timeline-strip.tsx`, kept in one spot so the two transport rows read as one language. */
const GHOST_ICON_BUTTON_CLASSNAME =
	"text-muted-foreground hover:bg-white/[0.04] hover:text-foreground";

type PlayerControlsProps = {
	/** Total timeline length in seconds — drives the scrubber range and the ` / total` timecode. */
	totalSeconds: number;
	className?: string;
};

/**
 * Custom on-theme transport bar over the Remotion `<Player>`
 * (docs/studio-quality-pass.md §5) — replaces the Player's built-in
 * `controls` chrome (see `player-canvas.tsx`) so play/pause/seek/volume/
 * fullscreen read as part of the app instead of Remotion's default skin.
 * Driven entirely through the imperative `PlayerRef` API via the shared
 * player hooks (`use-player-playback.ts`/`use-player-volume.ts`/
 * `use-player-fullscreen.ts`) — the same source of truth `timeline-strip.tsx`
 * subscribes to, so the two transport rows never disagree about play state.
 *
 * Play/pause reuses `MainButton` (glass + BorderBeam accent) per the design
 * brief; the scrubber, timecode, volume, and fullscreen are quieter
 * ghost/pill controls, matching the timeline's own zoom buttons.
 */
export function PlayerControls({
	totalSeconds,
	className,
}: PlayerControlsProps) {
	const { frame, isPlaying, seekTo, togglePlayback } = usePlayerPlayback();
	const { isMuted, setVolume, toggleMute, volume } = usePlayerVolume();
	const {
		isFullscreen,
		isSupported: fullscreenSupported,
		toggleFullscreen,
	} = usePlayerFullscreen();

	const totalFrames = Math.max(secondsToFrames(totalSeconds), 1);
	const isSilent = isMuted || volume === 0;

	return (
		<div
			className={cn(
				"glass-composer flex items-center gap-2 rounded-full px-2 py-1.5",
				className,
			)}
		>
			<MainButton
				type="button"
				size="icon-sm"
				wrapperClassName="shrink-0 rounded-full"
				className="rounded-full"
				aria-label={isPlaying ? "Pause" : "Play"}
				onClick={togglePlayback}
			>
				{isPlaying ? (
					<PauseIcon className="size-3.5" />
				) : (
					<PlayIcon className="size-3.5" />
				)}
			</MainButton>

			<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
				{formatTimecode(framesToSeconds(frame))} /{" "}
				{formatTimecode(totalSeconds)}
			</span>

			<Slider
				className="mx-1 min-w-0 flex-1"
				min={0}
				max={totalFrames}
				step={1}
				value={[Math.min(frame, totalFrames)]}
				onValueChange={([nextFrame]) => {
					if (typeof nextFrame === "number") {
						seekTo(nextFrame);
					}
				}}
				aria-label="Seek"
			/>

			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				className={cn("shrink-0", GHOST_ICON_BUTTON_CLASSNAME)}
				aria-label={isSilent ? "Unmute" : "Mute"}
				onClick={toggleMute}
			>
				{isSilent ? (
					<VolumeXIcon className="size-3.5" />
				) : (
					<Volume2Icon className="size-3.5" />
				)}
			</Button>

			<Slider
				className="w-16 shrink-0"
				min={0}
				max={1}
				step={0.01}
				value={[isMuted ? 0 : volume]}
				onValueChange={([nextVolume]) => {
					if (typeof nextVolume === "number") {
						setVolume(nextVolume);
					}
				}}
				aria-label="Volume"
			/>

			{fullscreenSupported ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={cn("shrink-0", GHOST_ICON_BUTTON_CLASSNAME)}
					aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
					onClick={toggleFullscreen}
				>
					{isFullscreen ? (
						<Minimize2Icon className="size-3.5" />
					) : (
						<Maximize2Icon className="size-3.5" />
					)}
				</Button>
			) : null}
		</div>
	);
}
