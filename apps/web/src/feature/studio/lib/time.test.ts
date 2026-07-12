import { describe, expect, test } from "bun:test";

import { isZoomWheelEvent, scrollLeftForZoomAtPointer } from "./time";

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
