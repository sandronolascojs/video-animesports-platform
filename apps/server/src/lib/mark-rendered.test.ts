import { describe, expect, test } from "bun:test";

import {
	ASSET_INVALID_REASON,
	ASSET_MISSING_KEY_REASON,
	HEAD_CHECK_ERROR_REASON,
	HEAD_CHECK_FAILED_REASON,
	type MarkRenderedDeps,
	runMarkRendered,
} from "./mark-rendered";

const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

function unreachable(label: string): never {
	throw new Error(`should not be called on this branch: ${label}`);
}

/** Builds a fully-wired fake deps object; individual tests override just the
 * calls relevant to the branch under test, leaving the rest as
 * `unreachable` tripwires so an unexpected extra call fails loudly. */
function fakeDeps(
	overrides: Partial<MarkRenderedDeps> = {},
): MarkRenderedDeps & {
	failedVersions: Array<{ versionId: string; failReason: string }>;
	failedAssets: Array<{ assetId: string; failReason: string }>;
} {
	const failedVersions: Array<{ versionId: string; failReason: string }> = [];
	const failedAssets: Array<{ assetId: string; failReason: string }> = [];

	return {
		failAsset: async (assetId, failReason) => {
			failedAssets.push({ assetId, failReason });
		},
		failVersion: async (versionId, failReason) => {
			failedVersions.push({ versionId, failReason });
		},
		failedAssets,
		failedVersions,
		findAsset: () => Promise.resolve(unreachable("findAsset")),
		findVersion: () => Promise.resolve(unreachable("findVersion")),
		headObject: () => Promise.resolve(unreachable("headObject")),
		...overrides,
	};
}

describe("runMarkRendered", () => {
	test("version not found -> not_found, nothing transitioned", async () => {
		const deps = fakeDeps({ findVersion: () => Promise.resolve(null) });

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({ type: "not_found" });
		expect(deps.failedVersions).toEqual([]);
		expect(deps.failedAssets).toEqual([]);
	});

	test("version not currently rendering -> conflict, nothing transitioned", async () => {
		const deps = fakeDeps({
			findVersion: () => Promise.resolve({ id: "version-1", status: "ready" }),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({ type: "conflict" });
		expect(deps.failedVersions).toEqual([]);
		expect(deps.failedAssets).toEqual([]);
	});

	test("asset missing -> version FAILED, asset left untouched", async () => {
		const deps = fakeDeps({
			findAsset: () => Promise.resolve(null),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: ASSET_INVALID_REASON,
			type: "verification_failed",
		});
		expect(deps.failedVersions).toEqual([
			{ failReason: ASSET_INVALID_REASON, versionId: "version-1" },
		]);
		expect(deps.failedAssets).toEqual([]);
	});

	test("asset wrong kind -> version FAILED, the unrelated asset is never mutated", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "image/png",
					id: "asset-1",
					kind: "keyframe",
					r2Key: "some/key.png",
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: ASSET_INVALID_REASON,
			type: "verification_failed",
		});
		expect(deps.failedAssets).toEqual([]);
	});

	test("render asset missing its r2Key -> both asset and version FAILED", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "video/mp4",
					id: "asset-1",
					kind: "render",
					r2Key: null,
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: ASSET_MISSING_KEY_REASON,
			type: "verification_failed",
		});
		expect(deps.failedAssets).toEqual([
			{ assetId: "asset-1", failReason: ASSET_MISSING_KEY_REASON },
		]);
		expect(deps.failedVersions).toEqual([
			{ failReason: ASSET_MISSING_KEY_REASON, versionId: "version-1" },
		]);
	});

	test("headObject throwing -> both asset and version FAILED (not left rendering forever)", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "video/mp4",
					id: "asset-1",
					kind: "render",
					r2Key: "renders/asset-1.mp4",
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
			headObject: () => Promise.reject(new Error("R2 is having a bad day")),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: HEAD_CHECK_ERROR_REASON,
			type: "verification_failed",
		});
		expect(deps.failedAssets).toEqual([
			{ assetId: "asset-1", failReason: HEAD_CHECK_ERROR_REASON },
		]);
		expect(deps.failedVersions).toEqual([
			{ failReason: HEAD_CHECK_ERROR_REASON, versionId: "version-1" },
		]);
	});

	test("object never uploaded (headObject -> null) -> both asset and version FAILED", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "video/mp4",
					id: "asset-1",
					kind: "render",
					r2Key: "renders/asset-1.mp4",
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
			headObject: () => Promise.resolve(null),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: HEAD_CHECK_FAILED_REASON,
			type: "verification_failed",
		});
	});

	test("oversized upload -> both asset and version FAILED", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "video/mp4",
					id: "asset-1",
					kind: "render",
					r2Key: "renders/asset-1.mp4",
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
			headObject: () =>
				Promise.resolve({
					contentType: "video/mp4",
					size: MAX_UPLOAD_SIZE_BYTES + 1,
				}),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: HEAD_CHECK_FAILED_REASON,
			type: "verification_failed",
		});
	});

	test("zero-byte upload -> both asset and version FAILED", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "video/mp4",
					id: "asset-1",
					kind: "render",
					r2Key: "renders/asset-1.mp4",
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
			headObject: () => Promise.resolve({ contentType: "video/mp4", size: 0 }),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			failReason: HEAD_CHECK_FAILED_REASON,
			type: "verification_failed",
		});
	});

	test("valid upload -> success, nothing marked failed", async () => {
		const deps = fakeDeps({
			findAsset: () =>
				Promise.resolve({
					contentType: "application/octet-stream",
					id: "asset-1",
					kind: "render",
					r2Key: "renders/asset-1.mp4",
				}),
			findVersion: () =>
				Promise.resolve({ id: "version-1", status: "rendering" }),
			headObject: () =>
				Promise.resolve({ contentType: "video/mp4", size: 12_345 }),
		});

		const outcome = await runMarkRendered(
			{
				maxUploadSizeBytes: MAX_UPLOAD_SIZE_BYTES,
				renderAssetId: "asset-1",
				versionId: "version-1",
			},
			deps,
		);

		expect(outcome).toEqual({
			assetId: "asset-1",
			fallbackContentType: "application/octet-stream",
			head: { contentType: "video/mp4", size: 12_345 },
			type: "success",
		});
		expect(deps.failedVersions).toEqual([]);
		expect(deps.failedAssets).toEqual([]);
	});
});
