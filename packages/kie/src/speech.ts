import type { AudioLanguage } from "@video-platform-challenge/types";

import { type CreateTaskResult, createTask } from "./client";
import { KieError } from "./errors";

// Single-voice-per-call model, matching the MVP's "one voice per project
// audioLanguage" (docs/video-engine-architecture.md §5b,
// TTS_VOICE_BY_LANGUAGE — packages/types). kie also exposes
// `elevenlabs/text-to-dialogue-v3` for multi-voice conversations in one call
// — out of scope until per-character voices land (§5b: "v-next refinement").
//
// kie-API-only, confirmed (architecture/v2-voice-pipeline): this goes
// through kie.ai's OWN `createTask` (`./client`, the same client every other
// provider call in this package uses, authenticated with `KIE_API_KEY`) with
// `model: "elevenlabs/text-to-speech-multilingual-v2"` — kie.ai proxies the
// ElevenLabs call server-side. There is no direct call to ElevenLabs' own
// API anywhere in this codebase, and no separate ElevenLabs API key exists.
// `voiceId` below is just a model input parameter kie.ai forwards along.
const ELEVENLABS_TTS_MODEL = "elevenlabs/text-to-speech-multilingual-v2";

/**
 * ElevenLabs' documented cap (confirmed against
 * https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2,
 * fetched 2026-07-11).
 */
export const MAX_SPEECH_TEXT_LENGTH = 5000;

export interface GenerateSpeechInput {
	text: string;
	/**
	 * AudioLanguage's values ("ja" | "en") ARE ISO 639-1 codes, so they map
	 * to kie's `language_code` with no lookup table.
	 */
	language: AudioLanguage;
	/**
	 * ElevenLabs voice id. Which voice narrates a project is a product
	 * decision (template default, or a future per-project setting) — this
	 * adapter stays business-logic-free (docs §8: "zero business logic;
	 * pure provider adapter"), so callers must supply it.
	 */
	voiceId: string;
	callBackUrl?: string;
}

export async function generateSpeech(
	input: GenerateSpeechInput,
): Promise<CreateTaskResult> {
	const { text, language, voiceId, callBackUrl } = input;

	if (text.length === 0 || text.length > MAX_SPEECH_TEXT_LENGTH) {
		throw new KieError(
			`text must be between 1 and ${MAX_SPEECH_TEXT_LENGTH} characters (got ${text.length})`,
			{ status: 400 },
		);
	}

	return createTask({
		model: ELEVENLABS_TTS_MODEL,
		callBackUrl,
		input: {
			text,
			voice: voiceId,
			language_code: language,
		},
	});
}
