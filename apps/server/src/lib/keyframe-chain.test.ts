import { describe, expect, test } from "bun:test";

import { nextPreviousKeyframeAssetId } from "./keyframe-chain";

describe("nextPreviousKeyframeAssetId", () => {
	test("advances to the newly generated asset on success", () => {
		expect(nextPreviousKeyframeAssetId("asset-2", "asset-1")).toBe("asset-2");
	});

	test("keeps the last successful asset when the current keyframe fails", () => {
		expect(nextPreviousKeyframeAssetId(null, "asset-1")).toBe("asset-1");
	});

	test("stays null when there is no prior successful asset and this one also fails", () => {
		expect(nextPreviousKeyframeAssetId(null, null)).toBeNull();
	});

	test("advances from null to the first successful asset", () => {
		expect(nextPreviousKeyframeAssetId("asset-1", null)).toBe("asset-1");
	});
});
