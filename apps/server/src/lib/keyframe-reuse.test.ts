import { describe, expect, test } from "bun:test";

import { resolveReusableKeyframeAsset } from "./keyframe-reuse";

describe("resolveReusableKeyframeAsset", () => {
	test("start anchor reuses the previous scene's end keyframe when present", () => {
		const assetId = resolveReusableKeyframeAsset({
			attach: "start",
			previousSceneEndKeyframeAssetId: "asset-prev-end",
			nextSceneStartKeyframeAssetId: "asset-next-start",
		});
		expect(assetId).toBe("asset-prev-end");
	});

	test("end anchor reuses the next scene's start keyframe when present", () => {
		const assetId = resolveReusableKeyframeAsset({
			attach: "end",
			previousSceneEndKeyframeAssetId: "asset-prev-end",
			nextSceneStartKeyframeAssetId: "asset-next-start",
		});
		expect(assetId).toBe("asset-next-start");
	});

	test("start anchor ignores the next scene's asset entirely", () => {
		const assetId = resolveReusableKeyframeAsset({
			attach: "start",
			previousSceneEndKeyframeAssetId: null,
			nextSceneStartKeyframeAssetId: "asset-next-start",
		});
		expect(assetId).toBeNull();
	});

	test("end anchor ignores the previous scene's asset entirely", () => {
		const assetId = resolveReusableKeyframeAsset({
			attach: "end",
			previousSceneEndKeyframeAssetId: "asset-prev-end",
			nextSceneStartKeyframeAssetId: null,
		});
		expect(assetId).toBeNull();
	});

	test("no neighbor (first/last scene) falls through to regeneration (null)", () => {
		expect(
			resolveReusableKeyframeAsset({
				attach: "start",
				previousSceneEndKeyframeAssetId: undefined,
				nextSceneStartKeyframeAssetId: undefined,
			}),
		).toBeNull();
		expect(
			resolveReusableKeyframeAsset({
				attach: "end",
				previousSceneEndKeyframeAssetId: undefined,
				nextSceneStartKeyframeAssetId: undefined,
			}),
		).toBeNull();
	});
});
