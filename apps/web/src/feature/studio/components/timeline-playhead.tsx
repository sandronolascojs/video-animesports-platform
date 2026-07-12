"use client";

export type TimelinePlayheadProps = {
	leftPx: number;
	onScrubPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
	onScrubPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
	onScrubPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
};

/**
 * Vertical line + top grabber spanning the ruler and the track (docs'
 * requirement 3), synced both ways with the Player via `use-player-playback`.
 * The line itself is `pointer-events-none` so it never blocks clicks on
 * clips underneath it — only the grabber knob is a drag target, in addition
 * to the ruler/track background (`timeline-strip.tsx` wires the same three
 * scrub handlers to all of them).
 */
export function TimelinePlayhead({
	leftPx,
	onScrubPointerDown,
	onScrubPointerMove,
	onScrubPointerEnd,
}: TimelinePlayheadProps) {
	return (
		<div
			className="pointer-events-none absolute inset-y-0 left-0 z-20"
			style={{ transform: `translateX(${leftPx}px)` }}
		>
			<div
				aria-hidden
				className="pointer-events-auto absolute top-0 flex h-3 w-3 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
				onPointerDown={onScrubPointerDown}
				onPointerMove={onScrubPointerMove}
				onPointerUp={onScrubPointerEnd}
				onPointerCancel={onScrubPointerEnd}
			>
				<div className="size-2.5 rounded-full bg-primary shadow-[0_0_0_2px_var(--background)]" />
			</div>
			<div className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-primary" />
		</div>
	);
}
