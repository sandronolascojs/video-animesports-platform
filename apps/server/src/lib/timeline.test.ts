import { describe, expect, test } from "bun:test";

import { findTimelineCompletenessViolations } from "./timeline";

describe("findTimelineCompletenessViolations", () => {
	test("returns empty set when submission exactly matches (reorder only)", () => {
		const valid = new Set(["a", "b", "c"]);
		const violations = findTimelineCompletenessViolations(valid, [
			"c",
			"a",
			"b",
		]);
		expect(violations.size).toBe(0);
	});

	test("flags a missing scene id", () => {
		const valid = new Set(["a", "b", "c"]);
		const violations = findTimelineCompletenessViolations(valid, ["a", "b"]);
		expect([...violations]).toEqual(["c"]);
	});

	test("flags an unknown/foreign scene id", () => {
		const valid = new Set(["a", "b"]);
		const violations = findTimelineCompletenessViolations(valid, [
			"a",
			"b",
			"foreign",
		]);
		expect([...violations]).toEqual(["foreign"]);
	});

	test("flags a duplicated scene id", () => {
		const valid = new Set(["a", "b"]);
		const violations = findTimelineCompletenessViolations(valid, [
			"a",
			"a",
			"b",
		]);
		expect([...violations]).toEqual(["a"]);
	});

	test("flags missing + unknown + duplicate together", () => {
		const valid = new Set(["a", "b", "c"]);
		// missing "c", unknown "z", duplicate "a"
		const violations = findTimelineCompletenessViolations(valid, [
			"a",
			"a",
			"b",
			"z",
		]);
		expect(violations.has("c")).toBe(true);
		expect(violations.has("z")).toBe(true);
		expect(violations.has("a")).toBe(true);
		expect(violations.has("b")).toBe(false);
	});

	test("empty submission against empty project is valid", () => {
		const violations = findTimelineCompletenessViolations(new Set(), []);
		expect(violations.size).toBe(0);
	});

	test("empty submission against a non-empty project flags every scene as missing", () => {
		const valid = new Set(["a", "b"]);
		const violations = findTimelineCompletenessViolations(valid, []);
		expect([...violations].sort()).toEqual(["a", "b"]);
	});
});
