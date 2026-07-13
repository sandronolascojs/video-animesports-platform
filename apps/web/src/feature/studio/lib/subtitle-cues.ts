import { DIALOGUE_WORDS_PER_SECOND } from "@video-platform-challenge/types";

// Estimated time-synced subtitles (docs/studio-quality-pass.md §3, OPEN
// QUESTION 2 — decision: option A, "estimated split", owner-confirmed). The
// DB still stores exactly ONE `subtitleText` string per scene (no schema
// change, no STT, no TTS word timestamps) — this module is the ONLY place
// that ever splits it into short, timed cues. Both the Player
// (`remotion/composition.tsx`'s `SubtitleOverlay`) and the export burn-in
// (`export.ts`'s `reencodeVideoScene`) call the exact same two functions
// below against the exact same inputs, so a preview paused at time T and an
// exported frame at time T always show the identical cue text — see each
// call site's own doc comment for how it derives "seconds into the scene".
//
// Algorithm (word-count-proportional distribution, anime-style short cues):
// 1. Split the full line into "natural" cues on sentence-ending punctuation
//    (`. ! ? …`) so each cue is (at most) one sentence.
// 2. Any cue still longer than `MAX_CUE_WORDS` gets split further — first at
//    comma clause boundaries (reads more naturally than a mid-clause cut),
//    then, if a resulting clause is STILL over the cap (or there was no
//    comma at all), a hard word-count cap chops it into fixed-size chunks.
// 3. Cues only cover the estimated SPEAKING window, not the whole scene —
//    a caption that stays up for the entire clip while nobody's talking
//    (e.g. a 9s goal shot showing "This one's mine!" for all 9s) reads as a
//    bug, not a caption. `speechSeconds` is estimated from the word count at
//    `DIALOGUE_WORDS_PER_SECOND`, floored at `MIN_SPEECH_SECONDS` and capped
//    at `sceneDurationSeconds`. The window starts at `LEAD_IN_SECONDS` (a
//    tiny offset so the line doesn't pop in on frame 0) and ends at
//    `leadIn + speechSeconds`, capped again so it never runs past
//    `sceneDurationSeconds`. Each cue's on-screen WINDOW is proportional to
//    its own word count out of the total word count, spread across that
//    `[leadIn, windowEnd]` interval — cues are contiguous
//    (cue[i].endSeconds === cue[i + 1].startSeconds) and the very last cue's
//    `endSeconds` is pinned to exactly `windowEnd` (not a running float sum)
//    so floating-point drift can never leave a sliver of dead air inside the
//    speech window. After the last cue's `endSeconds`, `activeCueAt` returns
//    `null` for the remainder of the scene — silence has no subtitle.

export type SubtitleCue = {
	text: string;
	startSeconds: number;
	endSeconds: number;
};

/** Speech is estimated to start this many seconds into the scene, so a cue never pops in right on frame 0. */
const LEAD_IN_SECONDS = 0.4;

/** Floor for the estimated speaking duration, so even a one-word line holds its cue on screen long enough to read. */
const MIN_SPEECH_SECONDS = 1;

/** A cue longer than this many words gets split further (comma clause, then a hard cap) — keeps every on-screen cue short enough to read in its window, anime-caption style rather than a paragraph. */
const MAX_CUE_WORDS = 8;

/** Splits on whitespace that follows a sentence-ending mark (`.`, `!`, `?`, `…`) and precedes the next non-space character — each resulting piece keeps its own trailing punctuation. A line with no sentence-ending punctuation at all splits into exactly one piece (the whole trimmed line), which is what makes "single short line → one cue" work with no special-casing. */
const SENTENCE_BOUNDARY_REGEX = /(?<=[.!?…])\s+(?=\S)/;

/** Splits on whitespace that follows a comma and precedes the next non-space character — used only as the first attempt to break up an over-long sentence at a natural clause boundary before falling back to a hard word cap. */
const CLAUSE_BOUNDARY_REGEX = /(?<=,)\s+(?=\S)/;

function wordCount(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

/** Hard fallback: chops `text` into fixed-size, `MAX_CUE_WORDS`-word chunks. Used both directly (no comma to split on) and per-clause (a single clause that's still too long on its own). */
function splitByWordCap(text: string): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length <= MAX_CUE_WORDS) {
		return [text.trim()];
	}
	const chunks: string[] = [];
	for (let index = 0; index < words.length; index += MAX_CUE_WORDS) {
		chunks.push(words.slice(index, index + MAX_CUE_WORDS).join(" "));
	}
	return chunks;
}

/** Splits one over-long sentence at comma clause boundaries, then applies `splitByWordCap` to any clause that's still over the cap (or to the whole sentence when it has no comma at all). */
function splitLongSentence(sentence: string): string[] {
	if (wordCount(sentence) <= MAX_CUE_WORDS) {
		return [sentence];
	}
	const clauses = sentence
		.split(CLAUSE_BOUNDARY_REGEX)
		.map((clause) => clause.trim())
		.filter((clause) => clause.length > 0);
	if (clauses.length <= 1) {
		return splitByWordCap(sentence);
	}
	return clauses.flatMap(splitByWordCap);
}

/** Splits `fullText` into an ordered list of cue TEXTS (no timing yet) — sentence boundaries first, then long-sentence splitting. Empty/whitespace-only input yields no cues at all. */
function splitIntoCueTexts(fullText: string): string[] {
	const trimmed = fullText.trim();
	if (trimmed.length === 0) {
		return [];
	}
	const sentences = trimmed
		.split(SENTENCE_BOUNDARY_REGEX)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 0);
	const base = sentences.length > 0 ? sentences : [trimmed];
	return base.flatMap(splitLongSentence);
}

/**
 * Splits `fullText` into short, contiguous, time-boxed cues spanning ONLY
 * the estimated speech window `[leadIn, windowEnd]` — never the whole
 * scene. Pure + deterministic — same input always produces the same cues,
 * which is exactly what "Player preview and the exported MP4 match exactly"
 * requires (both call sites build cues fresh from the same
 * `Scene.subtitleText` + scene duration, never persist them).
 *
 * A non-positive duration or an empty/whitespace-only `fullText` returns no
 * cues (nothing to show for the scene's whole runtime either way).
 */
export function buildSubtitleCues(
	fullText: string,
	sceneDurationSeconds: number,
): SubtitleCue[] {
	if (sceneDurationSeconds <= 0) {
		return [];
	}
	const cueTexts = splitIntoCueTexts(fullText);
	if (cueTexts.length === 0) {
		return [];
	}

	const wordCounts = cueTexts.map(wordCount);
	const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
	if (totalWords === 0) {
		return [];
	}

	// Estimated time actually spent speaking the line — floored so even a
	// one-word cue holds long enough to read, capped so a very long line in
	// a short scene never claims more than the scene itself has to give.
	const speechSeconds = Math.min(
		sceneDurationSeconds,
		Math.max(MIN_SPEECH_SECONDS, totalWords / DIALOGUE_WORDS_PER_SECOND),
	);
	// The lead-in itself can never exceed the scene (only matters for a
	// pathologically short `sceneDurationSeconds`, e.g. in a unit test).
	const windowStart = Math.min(LEAD_IN_SECONDS, sceneDurationSeconds);
	// "If leadIn + speechSeconds would exceed sceneDurationSeconds, cap the
	// window to the scene end" — the speech window never runs past the
	// scene, even though `speechSeconds` alone was already within bounds.
	const windowEnd = Math.min(windowStart + speechSeconds, sceneDurationSeconds);
	const windowSeconds = windowEnd - windowStart;

	const cues: SubtitleCue[] = [];
	let cursorSeconds = windowStart;
	let wordsSoFar = 0;
	for (let index = 0; index < cueTexts.length; index++) {
		const text = cueTexts[index] as string;
		wordsSoFar += wordCounts[index] as number;
		const isLastCue = index === cueTexts.length - 1;
		// The last cue's end is pinned to `windowEnd` exactly (rather than
		// `windowStart + wordsSoFar / totalWords * windowSeconds`, which —
		// being a fresh float division — is not guaranteed to land on the
		// exact same value) so cues always cover the FULL speech window with
		// no rounding gap at the very end, and nothing beyond it.
		const endSeconds = isLastCue
			? windowEnd
			: windowStart + (wordsSoFar / totalWords) * windowSeconds;
		cues.push({ endSeconds, startSeconds: cursorSeconds, text });
		cursorSeconds = endSeconds;
	}
	return cues;
}

/**
 * Real STT cues take priority over the estimate above (docs
 * media-ops-container.md Feature 2): when the scene carries non-empty
 * `speechCues` — persisted server-side by `generation.service.ts::
 * extractAndStoreSceneSubtitles` from the scene's ACTUAL spoken audio via
 * kie's ElevenLabs Scribe STT — those are used VERBATIM instead of the
 * word-count estimate `buildSubtitleCues` produces. `speechCues` is
 * structurally identical to `SubtitleCue` (`{ text, startSeconds,
 * endSeconds }`, see packages/api's `SpeechCue`/`sceneSchema.speechCues`), so
 * no conversion is needed — only sorted defensively by `startSeconds` (kie/DB
 * insertion order isn't a documented guarantee) before being handed to
 * `activeCueAt`, which requires cues to be encountered in time order.
 *
 * Both the Player (`composition.tsx`'s `SubtitleOverlay`) and the export
 * burn-in (`export.ts`'s `reencodeVideoScene`) call this ONE function instead
 * of `buildSubtitleCues` directly, so a scene with real STT timing renders
 * identically in both places — same guarantee the estimate always had.
 */
export function resolveSubtitleCues(
	fullText: string | null,
	sceneDurationSeconds: number,
	speechCues?: readonly SubtitleCue[] | null,
): SubtitleCue[] {
	if (speechCues && speechCues.length > 0) {
		return [...speechCues].sort((a, b) => a.startSeconds - b.startSeconds);
	}
	return buildSubtitleCues(fullText ?? "", sceneDurationSeconds);
}

/**
 * The cue active at `secondsIntoScene`, or `null` when the scene has no
 * subtitle cues (empty `subtitleText`) or `secondsIntoScene` falls outside
 * every cue's window. Each cue's window is `[startSeconds, endSeconds)` —
 * half-open, matching `findActiveScene`'s own "end is exclusive" convention
 * in `composition.tsx` — EXCEPT the very last cue, whose window is closed
 * (`endSeconds` inclusive) so the final instant of the scene still shows a
 * cue instead of going blank one frame early.
 */
export function activeCueAt(
	cues: readonly SubtitleCue[],
	secondsIntoScene: number,
): string | null {
	for (let index = 0; index < cues.length; index++) {
		const cue = cues[index] as SubtitleCue;
		const isLastCue = index === cues.length - 1;
		const withinWindow = isLastCue
			? secondsIntoScene >= cue.startSeconds &&
				secondsIntoScene <= cue.endSeconds
			: secondsIntoScene >= cue.startSeconds &&
				secondsIntoScene < cue.endSeconds;
		if (withinWindow) {
			return cue.text;
		}
	}
	return null;
}
