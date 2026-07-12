"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

export type TimelinePlayheadProps = {
	leftPx: number;
	/** True while a scrub gesture is in flight (started on the ruler, track, or this handle) — springs the handle the same as a direct hover. */
	isScrubbing: boolean;
	onScrubPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
	onScrubPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
	onScrubPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
};

// Ease-out, no bounce — same crisp spring `scenes-panel.tsx`/`show-more.tsx`
// use for interactive UI (as opposed to the elastic curves reserved for
// nothing in this app; docs/studio-design-language.md §4 "no bounce, no
// elastic").
const HANDLE_SPRING = { type: "spring", duration: 0.25, bounce: 0 } as const;

/**
 * Slim capsule time cursor (smoothui scrubber's look, docs §3c) spanning the
 * ruler and the track: a rounded capsule line plus a small pill handle at
 * the top that springs slightly larger on hover or while actively scrubbing
 * — `useReducedMotion` collapses the spring to an instant snap. The line
 * stays `pointer-events-none` so it never blocks clicks on clips underneath
 * it — only the handle is a drag target, in addition to the ruler/track
 * background (`timeline-strip.tsx` wires the same three scrub handlers to
 * all of them).
 */
export function TimelinePlayhead({
	leftPx,
	isScrubbing,
	onScrubPointerDown,
	onScrubPointerMove,
	onScrubPointerEnd,
}: TimelinePlayheadProps) {
	const [isHovering, setIsHovering] = useState(false);
	const shouldReduceMotion = useReducedMotion();
	const isActive = isHovering || isScrubbing;

	return (
		<div
			className="pointer-events-none absolute inset-y-0 left-0 z-20"
			style={{ transform: `translateX(${leftPx}px)` }}
		>
			<div
				aria-hidden
				className="pointer-events-auto absolute top-0 flex h-4 w-4 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
				onPointerDown={onScrubPointerDown}
				onPointerMove={onScrubPointerMove}
				onPointerUp={onScrubPointerEnd}
				onPointerCancel={onScrubPointerEnd}
				onMouseEnter={() => setIsHovering(true)}
				onMouseLeave={() => setIsHovering(false)}
			>
				<motion.div
					className="h-3.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_2px_var(--background)]"
					animate={{ scale: isActive ? 1.15 : 1 }}
					transition={shouldReduceMotion ? { duration: 0 } : HANDLE_SPRING}
				/>
			</div>
			<div className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-primary" />
		</div>
	);
}
