"use client";

import { useMemo } from "react";

import { formatRulerLabel, rulerTicksFor } from "@/feature/studio/lib/time";
import { cn } from "@/libs/utils";

export type TimelineRulerProps = {
	pxPerSecond: number;
	/** Ruler draws ticks for `[0, rulerSeconds]` — the strip pads this past the last clip (see `MIN_RULER_SECONDS`). */
	rulerSeconds: number;
	widthPx: number;
	onScrubPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
	onScrubPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
	onScrubPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
};

type Tick = { seconds: number; isMajor: boolean };

function buildTicks(rulerSeconds: number, pxPerSecond: number): Tick[] {
	const { majorStepSeconds, minorStepSeconds } = rulerTicksFor(pxPerSecond);
	const ticks: Tick[] = [];
	// Floating-point step accumulation drifts over hundreds of iterations —
	// index by minor-step count instead of repeatedly adding `minorStepSeconds`.
	const stepsPerMajor = Math.round(majorStepSeconds / minorStepSeconds);
	const tickCount = Math.floor(rulerSeconds / minorStepSeconds);
	for (let index = 0; index <= tickCount; index++) {
		const seconds = index * minorStepSeconds;
		// Never draw a tick past the timeline's own end — a phantom tick beyond
		// `rulerSeconds` overflowed the scroll container and read as clipped.
		if (seconds > rulerSeconds + 1e-6) {
			break;
		}
		ticks.push({ isMajor: index % stepsPerMajor === 0, seconds });
	}
	return ticks;
}

/**
 * Horizontal time ruler (docs' "real NLE timeline" requirement 1) rendered in
 * the smoothui **scrubber** visual language (docs/studio-design-language.md
 * §3c): thin rounded `foreground`-tinted tick pills — brighter/taller majors,
 * fainter/shorter minors — with mono `tabular-nums` labels on the majors at an
 * adaptive density so they never collide at any zoom. The first and last
 * labels are edge-anchored (left-/right-aligned to their tick) so they never
 * bleed past — and get clipped by — the scroll container's edge. Click/drag
 * scrubs the player — the same gesture the track below supports, so the ruler
 * and the track feel like one scrubbable surface.
 */
export function TimelineRuler({
	pxPerSecond,
	rulerSeconds,
	widthPx,
	onScrubPointerDown,
	onScrubPointerMove,
	onScrubPointerEnd,
}: TimelineRulerProps) {
	const ticks = useMemo(
		() => buildTicks(rulerSeconds, pxPerSecond),
		[rulerSeconds, pxPerSecond],
	);
	// Right-anchor the final major label so it ends AT its tick instead of
	// centering on it and overflowing the timeline's right edge.
	const lastMajorSeconds = useMemo(() => {
		for (let index = ticks.length - 1; index >= 0; index--) {
			const tick = ticks[index];
			if (tick?.isMajor) {
				return tick.seconds;
			}
		}
		return 0;
	}, [ticks]);

	return (
		// `z-30` lifts the ruler above the playhead (`z-20`) so the `0:00`
		// label stays legible instead of being hidden under the playhead
		// capsule when it's parked at the start.
		<div
			className="relative z-30 h-5 shrink-0 cursor-text touch-none select-none"
			style={{ width: widthPx }}
			onPointerDown={onScrubPointerDown}
			onPointerMove={onScrubPointerMove}
			onPointerUp={onScrubPointerEnd}
			onPointerCancel={onScrubPointerEnd}
		>
			{ticks.map((tick) => (
				<div
					key={tick.seconds}
					className="absolute bottom-0"
					style={{ left: tick.seconds * pxPerSecond }}
				>
					<div
						className={cn(
							"w-px rounded-full",
							tick.isMajor ? "h-2 bg-foreground/30" : "h-1.5 bg-foreground/15",
						)}
					/>
					{tick.isMajor ? (
						<span
							className={cn(
								"absolute bottom-2.5 whitespace-nowrap font-medium font-mono text-[11px] text-foreground/70 tabular-nums",
								// `left-1.5` (not `left-0`): nudge the first label a hair
								// right of its tick so the playhead — which parks at 0:00
								// — doesn't sit on top of the digits.
								tick.seconds === 0 && "left-1.5",
								tick.seconds !== 0 &&
									tick.seconds === lastMajorSeconds &&
									"left-0 -translate-x-full",
								tick.seconds !== 0 &&
									tick.seconds !== lastMajorSeconds &&
									"left-0 -translate-x-1/2",
							)}
						>
							{formatRulerLabel(tick.seconds)}
						</span>
					) : null}
				</div>
			))}
		</div>
	);
}
