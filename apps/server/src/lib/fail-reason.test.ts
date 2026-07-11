import { describe, expect, test } from "bun:test";

import { formatFailReason } from "./fail-reason";

describe("formatFailReason", () => {
	test("returns the base message unchanged when there is no failCode", () => {
		expect(formatFailReason("Video generation failed.")).toBe(
			"Video generation failed.",
		);
	});

	test("appends the kie failCode as a suffix when present", () => {
		expect(formatFailReason("Video generation failed.", "CONTENT_POLICY")).toBe(
			"Video generation failed. (kie CONTENT_POLICY)",
		);
	});

	test("never includes anything beyond the base message and the code", () => {
		const result = formatFailReason(
			"Keyframe 3 failed to generate.",
			"TIMEOUT",
		);
		expect(result).toBe("Keyframe 3 failed to generate. (kie TIMEOUT)");
		expect(result).not.toContain("undefined");
	});
});
