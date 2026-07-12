// Pure duration/offset math for the export mux loop (REN-1, docs
// ai-architecture-v1.md §5 finding 1: "export/Player duration drift"). Kept
// separate from export.ts so this arithmetic is testable under plain
// `bun:test` without touching Mediabunny/OffscreenCanvas/browser APIs.
//
// The bug this closes: the Player hard-cuts every scene at its authored
// `durationSeconds` (Remotion `Sequence`), but the export loop used to
// re-encode/copy the FULL decoded clip and advance the mux offset by
// whatever that decoded length happened to be — a clip generated even a
// fraction of a second longer than its authored duration silently diverged
// from what Studio showed. Every sample loop in export.ts now clamps to a
// `TrimWindow` and advances the shared timeline offset by the window's own
// duration, never the decoded clip length.
//
// Today every scene's window is `[0, durationSeconds]` (`defaultTrimWindow`)
// — the whole authored duration, from the start. `docs/scenes-architecture-
// v3.md`'s planned trim feature only changes what populates `start`/`end`
// (a future `entry.trimStart`/`entry.trimEnd`), not how the window is
// consumed here — swapping `defaultTrimWindow(scene.durationSeconds)` for
// `{ start: entry.trimStart ?? 0, end: entry.trimEnd ?? scene.durationSeconds }`
// at export.ts's one call site produces the `TrimWindow`. AI-6a correction:
// that alone is NOT the whole change — it was previously described here as a
// "two-line change", but `isBeforeTrimWindow` (below) sat exported and
// tested yet UNUSED by export.ts, so a nonzero `trimStart` would still mux
// pre-window samples in, negative-shifted, into the previous scene (`shiftIntoOutputTimeline`
// subtracts `window.start`, so a sample BEFORE the window gets a negative
// relative offset). The real requirement is THREE separate per-sample skip
// checks, one per mux loop in export.ts (`copyAudioScene`, `reencodeVideoScene`,
// `reencodeAudioScene`): each must call `isBeforeTrimWindow` right alongside
// its existing `isPastTrimWindow` check and `continue` (not `break` —
// `isPastTrimWindow` still owns stopping the loop) past any sample/packet it
// returns true for. With `trimStart` always 0 today, `isBeforeTrimWindow`
// is unconditionally false for every real timestamp (no sample precedes
// t=0), so wiring this in changes NOTHING about today's export output — it
// only closes the latent bug for whenever Phase B actually populates a
// nonzero `trimStart`.

/** A scene-local time window, in seconds, relative to the clip's own first
 * sample — NOT the shared output timeline offset. `end` is exclusive: a
 * sample/packet timestamped exactly at `end` is past the window. */
export interface TrimWindow {
	start: number;
	end: number;
}

/** Today's only window: the whole authored duration, from the start. */
export function defaultTrimWindow(durationSeconds: number): TrimWindow {
	return { start: 0, end: durationSeconds };
}

/** How much of the shared output timeline this scene occupies — the
 * AUTHORED window duration, never the decoded clip's actual length. This is
 * what the mux loop advances `videoOffset`/`audioOffset` by. */
export function trimWindowDurationSeconds(window: TrimWindow): number {
	return Math.max(0, window.end - window.start);
}

/** True once a decoded sample/packet's scene-relative timestamp has reached
 * (or passed) the window's end — the mux loop stops reading further
 * samples/packets for this scene as soon as this is true. */
export function isPastTrimWindow(
	relativeTimestampSeconds: number,
	window: TrimWindow,
): boolean {
	return relativeTimestampSeconds >= window.end;
}

/** True for a sample/packet before the window's start (only possible once a
 * future `trimStart` is nonzero) — skipped without being muxed, but the loop
 * keeps reading (unlike `isPastTrimWindow`, which stops it). */
export function isBeforeTrimWindow(
	relativeTimestampSeconds: number,
	window: TrimWindow,
): boolean {
	return relativeTimestampSeconds < window.start;
}

/** Shifts a scene-relative, window-relative timestamp onto the shared output
 * timeline: `window.start` is subtracted first (so a future non-zero
 * `trimStart` re-bases the kept portion to 0) before `baseOffsetSeconds`
 * (this scene's position in the output) is added. */
export function shiftIntoOutputTimeline(
	relativeTimestampSeconds: number,
	window: TrimWindow,
	baseOffsetSeconds: number,
): number {
	return relativeTimestampSeconds - window.start + baseOffsetSeconds;
}
