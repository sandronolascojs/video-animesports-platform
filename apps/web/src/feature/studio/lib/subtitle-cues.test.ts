import { describe, expect, test } from "bun:test";

import {
	activeCueAt,
	buildSubtitleCues,
	resolveSubtitleCues,
	type SubtitleCue,
} from "./subtitle-cues";

/** Sum of every cue's own on-screen window — should equal the estimated speech window's length for a non-empty result (cues are contiguous and pinned to `[leadIn, windowEnd]`), NOT the scene duration. */
function totalWindowSeconds(cues: SubtitleCue[]): number {
	return cues.reduce(
		(sum, cue) => sum + (cue.endSeconds - cue.startSeconds),
		0,
	);
}

describe("buildSubtitleCues", () => {
	test("empty text produces no cues", () => {
		expect(buildSubtitleCues("", 6)).toEqual([]);
		expect(buildSubtitleCues("   ", 6)).toEqual([]);
	});

	test("a non-positive scene duration produces no cues", () => {
		expect(buildSubtitleCues("Hello there.", 0)).toEqual([]);
		expect(buildSubtitleCues("Hello there.", -1)).toEqual([]);
	});

	test("a single short line becomes exactly one cue that ends well before a much longer scene, then goes silent", () => {
		// "Watch out!" = 2 words -> 2 / 2.5 = 0.8s, floored to the 1s minimum.
		const cues = buildSubtitleCues("Watch out!", 9);
		expect(cues).toEqual([
			{ endSeconds: 1.4, startSeconds: 0.4, text: "Watch out!" },
		]);
		// The cue ends at 1.4s — nowhere near the 9s scene duration (this is
		// the goal-shot bug: a short line must not caption the whole clip).
		expect(cues.at(-1)?.endSeconds).toBeLessThan(9);
	});

	test("a multi-sentence line splits into one cue per sentence, contiguous within the speech window (not the full scene)", () => {
		// 7 words total (2 + 2 + 3) -> 7 / 2.5 = 2.8s of speech, starting at
		// the 0.4s lead-in -> window is [0.4, 3.2], well inside a 20s scene.
		const cues = buildSubtitleCues(
			"He shoots. He scores. The crowd roars!",
			20,
		);

		expect(cues.map((cue) => cue.text)).toEqual([
			"He shoots.",
			"He scores.",
			"The crowd roars!",
		]);
		// Equal word counts (2, 2, 3 -> weighted) per sentence, contiguous windows.
		for (let index = 0; index < cues.length - 1; index++) {
			const current = cues[index] as SubtitleCue;
			const next = cues[index + 1] as SubtitleCue;
			expect(current.endSeconds).toBeCloseTo(next.startSeconds, 10);
		}
		expect(cues[0]?.startSeconds).toBeCloseTo(0.4, 10);
		expect(cues.at(-1)?.endSeconds).toBeCloseTo(3.2, 10);
		expect(totalWindowSeconds(cues)).toBeCloseTo(2.8, 10);
		// The 20s scene is nowhere close to being fully captioned.
		expect(cues.at(-1)?.endSeconds).toBeLessThan(20);
	});

	test("windows are proportional to each cue's word count within the speech window", () => {
		// "Go." = 1 word, "Kaito meets the ball mid-air." = 5 words -> 1/6 and
		// 5/6 of the 2.4s speech window (6 words / 2.5 wps), not of the scene.
		const cues = buildSubtitleCues("Go. Kaito meets the ball mid-air.", 20);
		expect(cues).toHaveLength(2);
		const [first, second] = cues as [SubtitleCue, SubtitleCue];
		expect(first.startSeconds).toBeCloseTo(0.4, 10); // lead-in
		expect(first.endSeconds).toBeCloseTo(0.8, 10); // 0.4 + 1/6 of 2.4
		expect(second.startSeconds).toBeCloseTo(0.8, 10);
		expect(second.endSeconds).toBeCloseTo(2.8, 10); // 0.4 + 2.4
		expect(second.endSeconds).toBeLessThan(20);
	});

	test("a long sentence splits at comma clause boundaries, staying within the speech window", () => {
		const longLine =
			"The keeper dives to his left, but the ball curls into the top right corner of the net.";
		const cues = buildSubtitleCues(longLine, 20);

		expect(cues.length).toBeGreaterThan(1);
		// No cue should be a long paragraph — every cue stays at/under the word cap.
		for (const cue of cues) {
			const words = cue.text.trim().split(/\s+/).filter(Boolean);
			expect(words.length).toBeLessThanOrEqual(8);
		}
		// 18 words / 2.5 wps = 7.2s of speech, starting at the lead-in.
		expect(cues[0]?.startSeconds).toBeCloseTo(0.4, 10);
		expect(cues.at(-1)?.endSeconds).toBeCloseTo(7.6, 10);
		expect(totalWindowSeconds(cues)).toBeCloseTo(7.2, 10);
		expect(cues.at(-1)?.endSeconds).toBeLessThan(20);
	});

	test("a long single-clause sentence (no commas) falls back to a hard word cap", () => {
		const longLine =
			"Kaito sprints past every defender chasing the ball toward the empty goal";
		const cues = buildSubtitleCues(longLine, 20);

		expect(cues.length).toBeGreaterThan(1);
		for (const cue of cues) {
			const words = cue.text.trim().split(/\s+/).filter(Boolean);
			expect(words.length).toBeLessThanOrEqual(8);
		}
		expect(cues.at(-1)?.endSeconds).toBeLessThan(20);
	});

	test("caps the speech window to the scene end when lead-in + speech would overrun it", () => {
		// "Go now" = 2 words -> 2 / 2.5 = 0.8s, floored to 1s of speech.
		// lead-in (0.4) + speech (1) = 1.4s, which overruns a 1.3s scene.
		const cues = buildSubtitleCues("Go now", 1.3);
		expect(cues).toHaveLength(1);
		expect(cues[0]?.startSeconds).toBeCloseTo(0.4, 10);
		// Capped to the scene end (1.3), not the uncapped 1.4.
		expect(cues[0]?.endSeconds).toBe(1.3);
	});
});

describe("resolveSubtitleCues", () => {
	test("falls back to the word-count estimate when speechCues is null", () => {
		const estimated = buildSubtitleCues("Watch out!", 9);
		expect(resolveSubtitleCues("Watch out!", 9, null)).toEqual(estimated);
	});

	test("falls back to the word-count estimate when speechCues is undefined", () => {
		const estimated = buildSubtitleCues("Watch out!", 9);
		expect(resolveSubtitleCues("Watch out!", 9)).toEqual(estimated);
	});

	test("falls back to the word-count estimate when speechCues is empty", () => {
		const estimated = buildSubtitleCues("Watch out!", 9);
		expect(resolveSubtitleCues("Watch out!", 9, [])).toEqual(estimated);
	});

	test("uses real speechCues verbatim (not re-derived from fullText) when present", () => {
		const speechCues: SubtitleCue[] = [
			{ endSeconds: 1.2, startSeconds: 0.5, text: "Go now" },
			{ endSeconds: 2.5, startSeconds: 1.2, text: "kick it" },
		];
		expect(
			resolveSubtitleCues("completely different text", 9, speechCues),
		).toEqual(speechCues);
	});

	test("sorts real speechCues by startSeconds defensively", () => {
		const unordered: SubtitleCue[] = [
			{ endSeconds: 2.5, startSeconds: 1.2, text: "kick it" },
			{ endSeconds: 1.2, startSeconds: 0.5, text: "Go now" },
		];
		expect(resolveSubtitleCues(null, 9, unordered)).toEqual([
			{ endSeconds: 1.2, startSeconds: 0.5, text: "Go now" },
			{ endSeconds: 2.5, startSeconds: 1.2, text: "kick it" },
		]);
	});
});

describe("activeCueAt", () => {
	test("returns null for an empty cue list", () => {
		expect(activeCueAt([], 1)).toBeNull();
	});

	test("returns null before the lead-in, the cue during its window, and null again in the trailing silence", () => {
		const cues = buildSubtitleCues("He shoots. He scores. The crowd roars!", 9);
		const speechWindowEnd = cues.at(-1)?.endSeconds as number;

		expect(activeCueAt(cues, 0)).toBeNull(); // before the lead-in
		expect(activeCueAt(cues, 0.4)).toBe("He shoots.");
		expect(activeCueAt(cues, speechWindowEnd)).toBe("The crowd roars!"); // last cue's end is inclusive
		// Well past the speech window but still inside the 9s scene — silence.
		expect(activeCueAt(cues, 5)).toBeNull();
		expect(activeCueAt(cues, 8.9)).toBeNull();
	});

	test("returns null before the first cue's start or after the last cue's end", () => {
		const cues: SubtitleCue[] = [
			{ endSeconds: 2, startSeconds: 1, text: "Go." },
		];
		expect(activeCueAt(cues, 0.5)).toBeNull();
		expect(activeCueAt(cues, 2.5)).toBeNull();
	});
});
