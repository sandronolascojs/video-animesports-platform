// Split out of transcribe.ts (kept import-free of `./models`, unlike that
// file, which pulls in `@video-platform-challenge/env/server` ->
// `cloudflare:workers` — a module that only resolves inside an actual
// Workers runtime). Mirrors this package's own existing split convention
// (model-ids.ts's doc comment: "pure string constants with ZERO imports...
// so eval code can import ... without touching models.ts"), and the same
// pattern packages/kie used for its now-removed speech-to-text.ts /
// speech-to-text-result.ts split. `transcribe.ts` re-exports this, so the
// split is invisible to every other import site.
import type { SpeechCue } from "@video-platform-challenge/types";

export type TranscriptionSegment = {
	text: string;
	startSecond: number;
	endSecond: number;
};

/**
 * Pure mapping: whisper's segment-level timestamps -> `SpeechCue[]`. Whisper
 * segments are already short, sentence-ish chunks — unlike the removed
 * kie/ElevenLabs path's word-level timestamps, no further grouping into cues
 * is needed; one cue per segment.
 */
export function segmentsToSpeechCues(
	segments: readonly TranscriptionSegment[],
): SpeechCue[] {
	return segments.map((segment) => ({
		text: segment.text,
		startSeconds: segment.startSecond,
		endSeconds: segment.endSecond,
	}));
}
