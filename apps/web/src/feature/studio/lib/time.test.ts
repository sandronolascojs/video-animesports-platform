import { describe, expect, test } from "bun:test";

import {
	ABSOLUTE_MIN_PX_PER_SECOND,
	clampPxPerSecond,
	fitPxPerSecond,
	isZoomWheelEvent,
	MAX_PX_PER_SECOND,
	MIN_PX_PER_SECOND,
	RULER_INSET_PX,
	scrollLeftForZoomAtPointer,
	zoomInStep,
	zoomOutStep,
} from "./time";

describe("isZoomWheelEvent", () => {
	test("true when ctrlKey is set — trackpad pinch fires as ctrlKey on every OS", () => {
		expect(isZoomWheelEvent({ ctrlKey: true, metaKey: false })).toBe(true);
	});

	test("true when metaKey is set — explicit Cmd+wheel on Mac", () => {
		expect(isZoomWheelEvent({ ctrlKey: false, metaKey: true })).toBe(true);
	});

	test("true when both are set", () => {
		expect(isZoomWheelEvent({ ctrlKey: true, metaKey: true })).toBe(true);
	});

	test("false for a plain wheel/scroll event with neither modifier", () => {
		expect(isZoomWheelEvent({ ctrlKey: false, metaKey: false })).toBe(false);
	});
});

describe("scrollLeftForZoomAtPointer", () => {
	test("keeps the time under the pointer fixed when zooming in", () => {
		// 3.125s sits under the pointer before zooming from 48 to 96 px/s.
		expect(scrollLeftForZoomAtPointer(100, 50, 48, 96)).toBeCloseTo(250, 9);
	});

	test("keeps the time under the pointer fixed when zooming out", () => {
		expect(scrollLeftForZoomAtPointer(250, 50, 96, 48)).toBeCloseTo(100, 9);
	});

	test("is a no-op when pxPerSecond is unchanged", () => {
		expect(scrollLeftForZoomAtPointer(120, 40, 48, 48)).toBeCloseTo(120, 9);
	});

	test("pointer at the container's left edge (pointerXPx: 0) still anchors correctly", () => {
		expect(scrollLeftForZoomAtPointer(0, 0, 48, 96)).toBeCloseTo(0, 9);
	});
});

describe("fitPxPerSecond", () => {
	test("fills the available width (minus the ruler inset on both edges) exactly", () => {
		const availableWidthPx = 1900;
		const rulerSeconds = 27;
		const expected = (availableWidthPx - RULER_INSET_PX * 2) / rulerSeconds;
		expect(fitPxPerSecond(availableWidthPx, rulerSeconds)).toBeCloseTo(
			expected,
			9,
		);
	});

	test("a wider container yields a larger fit scale for the same ruler length", () => {
		const narrow = fitPxPerSecond(800, 30);
		const wide = fitPxPerSecond(1600, 30);
		expect(wide).toBeGreaterThan(narrow);
	});

	test("falls back to the absolute floor for a not-yet-measured (0px) container", () => {
		expect(fitPxPerSecond(0, 30)).toBe(ABSOLUTE_MIN_PX_PER_SECOND);
	});

	test("falls back to the absolute floor when rulerSeconds is 0 (no divide-by-zero)", () => {
		expect(fitPxPerSecond(1200, 0)).toBe(ABSOLUTE_MIN_PX_PER_SECOND);
	});

	test("never dips below the absolute floor for a vanishingly small container", () => {
		expect(fitPxPerSecond(1, 300)).toBe(ABSOLUTE_MIN_PX_PER_SECOND);
	});
});

describe("clampPxPerSecond", () => {
	test("clamps below the floor up to MIN_PX_PER_SECOND", () => {
		expect(clampPxPerSecond(1)).toBe(MIN_PX_PER_SECOND);
	});

	test("clamps above the ceiling down to MAX_PX_PER_SECOND", () => {
		expect(clampPxPerSecond(9999)).toBe(MAX_PX_PER_SECOND);
	});

	test("passes through a value already inside [MIN, MAX]", () => {
		const inRange = (MIN_PX_PER_SECOND + MAX_PX_PER_SECOND) / 2;
		expect(clampPxPerSecond(inRange)).toBe(inRange);
	});
});

describe("zoom stepping (Premiere-style, independent of fit)", () => {
	test("zooming out from the fit scale goes BELOW it — the user can pull away from the timeline", () => {
		const fit = fitPxPerSecond(1900, 27);
		expect(zoomOutStep(fit)).toBeLessThan(fit);
	});

	test("zooming in from the fit scale goes ABOVE it", () => {
		const fit = fitPxPerSecond(1900, 27);
		expect(zoomInStep(fit)).toBeGreaterThan(fit);
	});

	test("repeated zoom-out never dips under MIN_PX_PER_SECOND", () => {
		let px = fitPxPerSecond(1900, 27);
		for (let i = 0; i < 50; i++) {
			px = zoomOutStep(px);
		}
		expect(px).toBe(MIN_PX_PER_SECOND);
	});

	test("repeated zoom-in never exceeds MAX_PX_PER_SECOND", () => {
		let px = fitPxPerSecond(1900, 27);
		for (let i = 0; i < 50; i++) {
			px = zoomInStep(px);
		}
		expect(px).toBe(MAX_PX_PER_SECOND);
	});
});
