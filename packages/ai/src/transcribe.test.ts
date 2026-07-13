import { describe, expect, test } from "bun:test";

import { segmentsToSpeechCues } from "./transcribe-result";

describe("segmentsToSpeechCues", () => {
	test("maps whisper's startSecond/endSecond onto SpeechCue's startSeconds/endSeconds", () => {
		expect(
			segmentsToSpeechCues([
				{ text: "Not this time!", startSecond: 0, endSecond: 1.56 },
				{ text: "Let's go.", startSecond: 1.56, endSecond: 2.9 },
			]),
		).toEqual([
			{ text: "Not this time!", startSeconds: 0, endSeconds: 1.56 },
			{ text: "Let's go.", startSeconds: 1.56, endSeconds: 2.9 },
		]);
	});

	test("returns an empty array for no segments", () => {
		expect(segmentsToSpeechCues([])).toEqual([]);
	});
});
