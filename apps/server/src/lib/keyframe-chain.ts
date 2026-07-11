// Pure decision logic extracted out of workflows/video-generation.ts's
// `runProjectGenerationMode` keyframe loop (MAJOR fix — keyframe reference
// silently dropped after a failure). Same testability split as
// lib/keyframe-reuse.ts: the workflow file imports `cloudflare:workers`, so
// the branching itself lives here where plain `bun:test` can exercise it
// directly.
//
// The K1..KN+1 keyframe chain (docs scenes-architecture-v3.md §2) feeds
// `previousKeyframeAssetId` into the NEXT keyframe's i2i reference as the
// loop advances. Before this fix, the loop advanced it unconditionally —
// including to `null` when the current keyframe failed to generate. That
// silently dropped the pixel anchor for the NEXT keyframe in the chain (a
// keyframe failure is scene-scoped, not chain-fatal, so generation keeps
// going — the following scene can still reach `video_ready`, just with no
// i2i reference at all, a quality regression nobody surfaces).
//
// The invariant: only advance the reference on an actual success. On
// failure, keep the last successfully-generated asset id as a best-effort
// degraded reference instead of dropping it.
export function nextPreviousKeyframeAssetId(
	keyframeAssetId: string | null,
	previousKeyframeAssetId: string | null,
): string | null {
	return keyframeAssetId ?? previousKeyframeAssetId;
}
