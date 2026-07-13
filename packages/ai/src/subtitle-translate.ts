import type {
	SpeechCue,
	SubtitleLanguage,
} from "@video-platform-challenge/types";
import { generateText, Output } from "ai";
import { z } from "zod";

import { gatewayModel, STUDIO_AGENT_MODEL } from "./models";

function subtitleLanguageName(code: SubtitleLanguage): string {
	return code === "ja" ? "Japanese" : "English";
}

/**
 * Translates each subtitle cue's text into `target`, preserving every cue's
 * timing (startSeconds/endSeconds). Meaning-translation, not transliteration.
 * If the model returns the wrong number of lines, the original cues are kept
 * unchanged (safety: never desync text from timing).
 */
export async function translateSubtitleCues(
	cues: SpeechCue[],
	target: SubtitleLanguage,
): Promise<SpeechCue[]> {
	if (cues.length === 0) {
		return cues;
	}
	const result = await generateText({
		model: gatewayModel(STUDIO_AGENT_MODEL),
		output: Output.object({
			schema: z.object({ lines: z.array(z.string()) }),
		}),
		prompt: [
			`Translate each of these subtitle lines into ${subtitleLanguageName(target)}.`,
			"Return an object with `lines`: EXACTLY one translated line per input line, in the SAME order and the SAME count. Translate the meaning as a natural caption — never transliterate, never merge or split lines, never add notes.",
			"",
			cues.map((cue, index) => `${index + 1}. ${cue.text}`).join("\n"),
		].join("\n"),
	});
	const lines = result.output.lines;
	if (lines.length !== cues.length) {
		return cues;
	}
	return cues.map((cue, index) => ({ ...cue, text: lines[index] ?? cue.text }));
}

/** Translates a single subtitle caption block into `target`. */
export async function translateSubtitleText(
	text: string,
	target: SubtitleLanguage,
): Promise<string> {
	const result = await generateText({
		model: gatewayModel(STUDIO_AGENT_MODEL),
		prompt: `Translate the following subtitle caption into ${subtitleLanguageName(target)}. Return ONLY the translation as a natural caption — no quotes, no notes, no transliteration.\n\n${text}`,
	});
	return result.text.trim();
}
