/**
 * Time math for the Studio timeline (docs/studio-ui.md "Implementation
 * rules": "fps, durations, timeline<->frames mapping... lives in Remotion").
 * `STUDIO_FPS` is declared ONCE here — `remotion/composition.tsx` re-exports
 * it so the Player and the timeline ruler/playhead can never drift apart.
 */
export const STUDIO_FPS = 30;

// ---- Zoom (px-per-second scale) --------------------------------------------

export const MIN_PX_PER_SECOND = 16;
export const MAX_PX_PER_SECOND = 160;
export const DEFAULT_PX_PER_SECOND = 48;
/** Ruler keeps drawing at least this many seconds of track even for a near-empty timeline. */
export const MIN_RULER_SECONDS = 15;

const ZOOM_STEP = 1.25;

export function clampPxPerSecond(pxPerSecond: number): number {
	return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

export function zoomInStep(pxPerSecond: number): number {
	return clampPxPerSecond(pxPerSecond * ZOOM_STEP);
}

export function zoomOutStep(pxPerSecond: number): number {
	return clampPxPerSecond(pxPerSecond / ZOOM_STEP);
}

/** Continuous zoom for ⌘/ctrl+scroll — `factor` > 1 zooms in, < 1 zooms out. */
export function zoomByFactor(pxPerSecond: number, factor: number): number {
	return clampPxPerSecond(pxPerSecond * factor);
}

/**
 * True for a wheel event that should zoom the timeline rather than pan it.
 * Trackpad pinch-zoom fires as a wheel event with `ctrlKey: true` on EVERY
 * OS (a browser convention, not an actually-held Ctrl key) — a Mac-only
 * `metaKey` check misses pinch entirely. `ctrlKey || metaKey` covers pinch
 * everywhere AND the explicit Cmd+wheel (Mac) / Ctrl+wheel (elsewhere)
 * modifier shortcut, so no platform branch is needed here at all.
 */
export function isZoomWheelEvent(event: {
	ctrlKey: boolean;
	metaKey: boolean;
}): boolean {
	return event.ctrlKey || event.metaKey;
}

/**
 * New scroll-container `scrollLeft` that keeps the timeline instant under
 * `pointerXPx` (viewport px, relative to the scroll container's left edge)
 * visually fixed while `pxPerSecond` changes — the "zoom under the cursor"
 * behavior every pro timeline/map view has. Re-derives the seconds under the
 * pointer at the OLD scale, then re-projects that same instant at the NEW
 * scale and subtracts the pointer offset back out.
 */
export function scrollLeftForZoomAtPointer(
	previousScrollLeft: number,
	pointerXPx: number,
	previousPxPerSecond: number,
	nextPxPerSecond: number,
): number {
	const secondsUnderPointer =
		(previousScrollLeft + pointerXPx) / previousPxPerSecond;
	return secondsUnderPointer * nextPxPerSecond - pointerXPx;
}

// ---- Frame <-> second conversions ------------------------------------------

export function secondsToFrames(
	seconds: number,
	fps: number = STUDIO_FPS,
): number {
	return Math.round(seconds * fps);
}

export function framesToSeconds(
	frames: number,
	fps: number = STUDIO_FPS,
): number {
	return frames / fps;
}

export function clampSeconds(seconds: number, maxSeconds: number): number {
	return Math.min(maxSeconds, Math.max(0, seconds));
}

// ---- Readouts ---------------------------------------------------------------

/** `mm:ss.f` (deciseconds) — the timeline header's current-time readout. */
export function formatTimecode(totalSeconds: number): string {
	const clamped = Math.max(0, totalSeconds);
	const minutes = Math.floor(clamped / 60);
	const seconds = Math.floor(clamped % 60);
	const deciseconds = Math.floor((clamped * 10) % 10);
	return `${minutes}:${String(seconds).padStart(2, "0")}.${deciseconds}`;
}

/** `m:ss` ruler tick label — whole seconds only, no fractional digit. */
export function formatRulerLabel(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.round(totalSeconds % 60);
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ---- Ruler tick density ------------------------------------------------------

export type RulerTicks = {
	majorStepSeconds: number;
	minorStepSeconds: number;
};

/** Candidate major-tick steps (seconds), narrowest first. */
const MAJOR_STEP_CANDIDATES = [1, 2, 5, 10, 15, 30, 60] as const;

/** Minor ticks per major step — keyed by the major step they subdivide. */
const MINOR_STEP_FOR_MAJOR: Record<number, number> = {
	1: 0.5,
	2: 1,
	5: 1,
	10: 2,
	15: 5,
	30: 10,
	60: 15,
};

/** Labels must sit at least this far apart (px) to never collide. */
const MIN_LABEL_SPACING_PX = 44;

/**
 * Adaptive tick density (requirement: "when zoomed out, label every 2s/5s so
 * labels never collide"). Picks the narrowest major step whose on-screen
 * spacing clears `MIN_LABEL_SPACING_PX`, then derives a minor-tick step that
 * evenly subdivides it.
 */
export function rulerTicksFor(pxPerSecond: number): RulerTicks {
	const majorStepSeconds =
		MAJOR_STEP_CANDIDATES.find(
			(step) => step * pxPerSecond >= MIN_LABEL_SPACING_PX,
		) ?? 60;
	const minorStepSeconds = MINOR_STEP_FOR_MAJOR[majorStepSeconds] ?? 1;
	return { majorStepSeconds, minorStepSeconds };
}
