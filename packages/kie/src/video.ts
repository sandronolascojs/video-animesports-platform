import type { AspectRatio } from "@video-platform-challenge/types";
import {
	MAX_SCENE_DURATION_SECONDS,
	MIN_SCENE_DURATION_SECONDS,
} from "@video-platform-challenge/types";

import { type CreateTaskResult, createTask } from "./client";
import { KieError } from "./errors";

const SEEDANCE_MODEL = "bytedance/seedance-2-mini";

/**
 * Product-mandated (docs/video-engine-architecture.md §1, §3) — not a
 * caller-configurable parameter. Seedance 2.0 mini supports 480p/720p; this
 * product only ever generates at 480p.
 */
const SEEDANCE_RESOLUTION = "480p";

/**
 * seedance-2-mini's documented cap on `reference_audio_urls` (verified
 * against https://docs.kie.ai/market/bytedance/seedance-2-mini, fetched
 * 2026-07-11): max 3 files, each 2–15s, wav/mp3, ≤15MB. Only the array-length
 * bound is enforceable in this adapter — per-file duration/format/size are
 * the caller's responsibility (this stays a pure provider adapter, docs §8:
 * "zero business logic"); the TTS-duration guard lives in
 * apps/server's generation.service.ts (architecture/v2-voice-pipeline).
 */
export const MAX_REFERENCE_AUDIO_URLS = 3;

export interface GenerateVideoInput {
	prompt: string;
	/**
	 * Keyframe fencing anchor — the chained first frame (docs
	 * last-frame-chaining.md Feature 1): scene i's `firstFrameUrl` is the REAL
	 * last frame extracted from scene i-1's rendered video (or this scene's
	 * own start keyframe as a fallback — scene 1, or when extraction failed).
	 */
	firstFrameUrl: string;
	/**
	 * Optional (docs last-frame-chaining.md Feature 1, superseding the prior
	 * always-fenced K_i→K_{i+1} approach): omitted so seedance animates ONE
	 * natural action forward from `firstFrameUrl` instead of being forced to
	 * converge on a second fixed endpoint — better physics. Tradeoff: video
	 * generation moves from concurrent to sequential per scene (each scene
	 * needs the previous one's real last frame first) — coherence over
	 * concurrency, owner call (see apps/server's video-generation.ts).
	 */
	lastFrameUrl?: string;
	/** See image.ts's note — our AspectRatio values pass straight through. */
	aspectRatio: AspectRatio;
	/** Integer seconds, 4-15 (docs §3; bounds shared with packages/types). */
	durationSeconds: number;
	/** kie.ai default is `true` (ambient audio/SFX under the lip-synced
	 * dialogue voice, when `referenceAudioUrls` is provided). */
	generateAudio?: boolean;
	/**
	 * Lip-synced dialogue reference audio (architecture/v2-voice-pipeline):
	 * signed GET URL(s) of TTS-generated scene audio, max
	 * `MAX_REFERENCE_AUDIO_URLS`. Seedance lip-syncs the on-screen character
	 * to this audio while rendering the clip. Omit or pass an empty array for
	 * a scene with no dialogue — `generateAudio`'s ambient/SFX track is what
	 * plays instead.
	 */
	referenceAudioUrls?: string[];
	callBackUrl?: string;
}

export async function generateVideo(
	input: GenerateVideoInput,
): Promise<CreateTaskResult> {
	const {
		prompt,
		firstFrameUrl,
		lastFrameUrl,
		aspectRatio,
		durationSeconds,
		generateAudio,
		referenceAudioUrls,
		callBackUrl,
	} = input;

	if (
		!Number.isInteger(durationSeconds) ||
		durationSeconds < MIN_SCENE_DURATION_SECONDS ||
		durationSeconds > MAX_SCENE_DURATION_SECONDS
	) {
		throw new KieError(
			`durationSeconds must be an integer between ${MIN_SCENE_DURATION_SECONDS} and ${MAX_SCENE_DURATION_SECONDS} (got ${durationSeconds})`,
			{ status: 400 },
		);
	}
	if (
		referenceAudioUrls &&
		referenceAudioUrls.length > MAX_REFERENCE_AUDIO_URLS
	) {
		throw new KieError(
			`referenceAudioUrls must contain at most ${MAX_REFERENCE_AUDIO_URLS} URLs (got ${referenceAudioUrls.length})`,
			{ status: 400 },
		);
	}

	return createTask({
		model: SEEDANCE_MODEL,
		callBackUrl,
		input: {
			prompt,
			first_frame_url: firstFrameUrl,
			...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
			aspect_ratio: aspectRatio,
			resolution: SEEDANCE_RESOLUTION,
			duration: durationSeconds,
			...(generateAudio === undefined ? {} : { generate_audio: generateAudio }),
			...(referenceAudioUrls && referenceAudioUrls.length > 0
				? { reference_audio_urls: referenceAudioUrls }
				: {}),
		},
	});
}
