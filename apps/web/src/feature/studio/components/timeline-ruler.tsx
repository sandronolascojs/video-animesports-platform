"use client";

import { useMemo } from "react";

import { formatRulerLabel, rulerTicksFor } from "@/feature/studio/lib/time";

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
	const tickCount = Math.floor(rulerSeconds / minorStepSeconds) + 1;
	for (let index = 0; index <= tickCount; index++) {
		const seconds = index * minorStepSeconds;
		const stepsPerMajor = Math.round(majorStepSeconds / minorStepSeconds);
		ticks.push({ isMajor: index % stepsPerMajor === 0, seconds });
	}
	return ticks;
}

/**
 * Horizontal time ruler (docs' "real NLE timeline" requirement 1): major
 * ticks with `0:00`/`0:01`... labels at an adaptive density so labels never
 * collide at any zoom, minor ticks between them. Click/drag scrubs the
 * player — the same gesture the track background below it supports, so the
 * ruler and the track feel like one scrubbable surface.
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

	return (
		<div
			className="relative h-5 shrink-0 cursor-text touch-none select-none"
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
						className={
							tick.isMajor ? "h-2.5 w-px bg-border" : "h-1.5 w-px bg-border/50"
						}
					/>
					{tick.isMajor ? (
						<span
							className={
								tick.seconds === 0
									? "absolute bottom-2.5 left-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground"
									: "absolute bottom-2.5 left-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-muted-foreground"
							}
						>
							{formatRulerLabel(tick.seconds)}
						</span>
					) : null}
				</div>
			))}
		</div>
	);
}
