// Pure decision logic extracted out of workflows/video-generation.ts's
// `runSceneRetryMode` (GEN-1, docs ai-architecture-v1.md §5 finding 1),
// same testability split as lib/fail-reason.ts / lib/scene-voice.ts: the
// workflow file imports `cloudflare:workers`, so the branching itself lives
// here where plain `bun:test` can exercise it directly.
//
// The K1..KN+1 keyframe chain (docs scenes-architecture-v3.md §2) means a
// scene's end keyframe and its immediate successor's start keyframe are
// literally the SAME asset — `runProjectGenerationMode`/`generateAndAttachKeyframe`
// only ever attach one generated image to both anchors. When a retry finds
// one of its own anchors missing, the sibling scene on that side may already
// hold the very same asset: reusing it (mirroring `runSingleSceneExtension`'s
// reuse of the previous scene's end keyframe) avoids both a visible
// discontinuity between independently-retried neighbors and a wasted, billed
// createTask call. Only fall through to regenerating when the sibling has
// nothing to offer either.

/**
 * Resolves a reusable keyframe asset id from a scene's neighbor(s) before a
 * retry regenerates it. `attach` picks which side is being resolved — only
 * the corresponding neighbor argument is consulted; the other is ignored so
 * callers can pass both without checking `attach` themselves.
 */
export function resolveReusableKeyframeAsset(args: {
	attach: "start" | "end";
	/** The previous scene's `endKeyframeAssetId` — the reuse candidate for a missing START anchor. */
	previousSceneEndKeyframeAssetId?: string | null;
	/** The next scene's `startKeyframeAssetId` — the reuse candidate for a missing END anchor. */
	nextSceneStartKeyframeAssetId?: string | null;
}): string | null {
	const candidate =
		args.attach === "start"
			? args.previousSceneEndKeyframeAssetId
			: args.nextSceneStartKeyframeAssetId;
	return candidate ?? null;
}
