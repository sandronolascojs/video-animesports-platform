import { describe, expect, test } from "bun:test";

import {
	defaultTrimWindow,
	isBeforeTrimWindow,
	isPastTrimWindow,
	shiftIntoOutputTimeline,
	trimWindowDurationSeconds,
} from "./export-trim-window";

describe("defaultTrimWindow", () => {
	test("spans the whole authored duration from zero", () => {
		expect(defaultTrimWindow(5)).toEqual({ end: 5, start: 0 });
	});
});

describe("trimWindowDurationSeconds", () => {
	test("equals the authored duration for the default window", () => {
		expect(trimWindowDurationSeconds(defaultTrimWindow(4.2))).toBeCloseTo(
			4.2,
			9,
		);
	});

	test("is the AUTHORED span, not tied to any decoded clip length", () => {
		// A future trim window: keep only seconds [1, 3) of a longer clip.
		expect(trimWindowDurationSeconds({ end: 3, start: 1 })).toBe(2);
	});

	test("never goes negative for a degenerate window", () => {
		expect(trimWindowDurationSeconds({ end: 1, start: 3 })).toBe(0);
	});
});

describe("isPastTrimWindow", () => {
	const window = defaultTrimWindow(2);

	test("false for a timestamp inside the window", () => {
		expect(isPastTrimWindow(1.9, window)).toBe(false);
	});

	test("true exactly at the boundary (end is exclusive)", () => {
		expect(isPastTrimWindow(2, window)).toBe(true);
	});

	test("true past the boundary — this is what stops decoding a clip generated slightly longer than authored", () => {
		expect(isPastTrimWindow(2.5, window)).toBe(true);
	});
});

describe("isBeforeTrimWindow", () => {
	test("false for the default (start: 0) window at any non-negative timestamp", () => {
		expect(isBeforeTrimWindow(0, defaultTrimWindow(5))).toBe(false);
	});

	test("true before a non-zero future trimStart", () => {
		expect(isBeforeTrimWindow(0.5, { end: 5, start: 1 })).toBe(true);
	});
});

describe("shiftIntoOutputTimeline", () => {
	test("adds the base offset for the default (start: 0) window", () => {
		expect(shiftIntoOutputTimeline(0.5, defaultTrimWindow(5), 10)).toBeCloseTo(
			10.5,
			9,
		);
	});

	test("re-bases against a non-zero trimStart before adding the offset", () => {
		expect(shiftIntoOutputTimeline(1.5, { end: 5, start: 1 }, 10)).toBeCloseTo(
			10.5,
			9,
		);
	});
});
