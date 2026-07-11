// Dependency-injected core of version.service.ts's `markRendered` (REN-2,
// docs ai-architecture-v1.md §5 finding 2). Same shape as
// generation-webhook.service.ts's `handleKieWebhook`: every DB/R2-touching
// dependency is an explicit parameter instead of an import, so plain
// `bun:test` can drive every branch with fake functions — `version.service.ts`
// itself imports `@video-platform-challenge/db`, which resolves
// `cloudflare:workers` at module load and can't be imported under plain
// `bun test` (see lib/fail-reason.ts's doc comment for the same constraint).
//
// Before this fix, only the size-verification branch (the last `if` below)
// ever transitioned the version to `failed` — a missing/wrong-kind asset, a
// render asset missing its r2Key, or `headObject` itself throwing all left
// the version stuck `rendering` for the full `RENDER_ABANDON_MINUTES` window
// (an indefinite spinner, and a blocked re-render slot). Every failure path
// here now resolves to a `verification_failed` outcome, which the caller
// (`version.service.ts::markRendered`) always turns into a FAILED
// transition before throwing.
import { AssetKind, VersionStatus } from "@video-platform-challenge/types";

export interface MarkRenderedVersionRecord {
	id: string;
	status: string;
}

export interface MarkRenderedAssetRecord {
	id: string;
	kind: string;
	r2Key: string | null;
	contentType: string | null;
}

export interface MarkRenderedHeadResult {
	size: number;
	contentType: string | null;
}

export interface MarkRenderedDeps {
	findVersion(id: string): Promise<MarkRenderedVersionRecord | null>;
	findAsset(id: string): Promise<MarkRenderedAssetRecord | null>;
	/** The post-upload R2 HEAD check. May throw (a transient R2 error) —
	 * the core catches it and treats it the same as a failed verification
	 * rather than let it escape as an unhandled rejection. */
	headObject(key: string): Promise<MarkRenderedHeadResult | null>;
	failVersion(versionId: string, failReason: string): Promise<void>;
	failAsset(assetId: string, failReason: string): Promise<void>;
}

export interface MarkRenderedInput {
	versionId: string;
	renderAssetId: string;
	maxUploadSizeBytes: number;
}

export type MarkRenderedOutcome =
	| { type: "not_found" }
	| { type: "conflict" }
	| { type: "verification_failed"; failReason: string }
	| {
			type: "success";
			assetId: string;
			head: MarkRenderedHeadResult;
			/** The asset's pre-verification contentType — `head.contentType`
			 * wins when R2 reports one, else this is the fallback (mirrors the
			 * pre-fix `head.contentType ?? asset.contentType`). */
			fallbackContentType: string | null;
	  };

export const ASSET_INVALID_REASON = "Render asset missing or invalid.";
export const ASSET_MISSING_KEY_REASON =
	"Render asset missing its uploaded object key.";
export const HEAD_CHECK_ERROR_REASON = "Failed to verify uploaded render.";
export const HEAD_CHECK_FAILED_REASON = "Render upload failed verification.";

/**
 * The `markRendered` state machine, pure decision logic over injected I/O.
 * `not_found`/`conflict` are the two genuinely-unreachable-to-fail branches
 * (docs finding 2's own carve-out): there's no version row to transition in
 * the first, and the version is already resolved to some OTHER terminal (or
 * racing) state in the second — neither has anything meaningful to fail.
 * Every other branch transitions the version (and the asset, where the
 * asset row genuinely is this version's own pending render asset) to
 * `failed` with a reason before resolving.
 */
export async function runMarkRendered(
	input: MarkRenderedInput,
	deps: MarkRenderedDeps,
): Promise<MarkRenderedOutcome> {
	const version = await deps.findVersion(input.versionId);
	if (!version) {
		return { type: "not_found" };
	}
	if (version.status !== VersionStatus.RENDERING) {
		return { type: "conflict" };
	}

	const asset = await deps.findAsset(input.renderAssetId);
	if (!asset || asset.kind !== AssetKind.RENDER) {
		// Not a real pending render asset for this version (missing, or
		// resolves to some unrelated/foreign-kind asset) — never mutate
		// whatever it DID resolve to, only the version this call is scoped to.
		await deps.failVersion(input.versionId, ASSET_INVALID_REASON);
		return { type: "verification_failed", failReason: ASSET_INVALID_REASON };
	}
	if (!asset.r2Key) {
		await deps.failAsset(asset.id, ASSET_MISSING_KEY_REASON);
		await deps.failVersion(input.versionId, ASSET_MISSING_KEY_REASON);
		return {
			type: "verification_failed",
			failReason: ASSET_MISSING_KEY_REASON,
		};
	}

	let head: MarkRenderedHeadResult | null;
	try {
		head = await deps.headObject(asset.r2Key);
	} catch (error) {
		console.error(
			`[mark-rendered] headObject failed for render asset ${asset.id}`,
			error,
		);
		await deps.failAsset(asset.id, HEAD_CHECK_ERROR_REASON);
		await deps.failVersion(input.versionId, HEAD_CHECK_ERROR_REASON);
		return { type: "verification_failed", failReason: HEAD_CHECK_ERROR_REASON };
	}

	if (!head || head.size === 0 || head.size > input.maxUploadSizeBytes) {
		await deps.failAsset(asset.id, HEAD_CHECK_FAILED_REASON);
		await deps.failVersion(input.versionId, HEAD_CHECK_FAILED_REASON);
		return {
			type: "verification_failed",
			failReason: HEAD_CHECK_FAILED_REASON,
		};
	}

	return {
		type: "success",
		assetId: asset.id,
		fallbackContentType: asset.contentType,
		head,
	};
}
