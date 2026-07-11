import type { AspectRatio } from "@video-platform-challenge/types";

import { type CreateTaskResult, createTask } from "./client";
import { KieError } from "./errors";

const TEXT_TO_IMAGE_MODEL = "gpt-image-2-text-to-image";
const IMAGE_TO_IMAGE_MODEL = "gpt-image-2-image-to-image";

/**
 * gpt-image-2-image-to-image caps `input_urls` at 16
 * (docs/video-engine-architecture.md §2, §3; confirmed against
 * https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image, fetched
 * 2026-07-11).
 */
export const MAX_IMAGE_INPUT_URLS = 16;

export type ImageResolution = "1K" | "2K" | "4K";

export interface GenerateImageInput {
	prompt: string;
	/**
	 * Our domain values ("16:9" | "9:16") are valid literal members of
	 * kie.ai's own `aspect_ratio` enum — passed straight through, no mapping
	 * table needed (verified against
	 * https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image, fetched
	 * 2026-07-11).
	 */
	aspectRatio: AspectRatio;
	/**
	 * Reference images (character sheets, location sheet, previous
	 * keyframe...). Omit/empty for a from-scratch generation (sheets, K1);
	 * provide 1-16 for i2i (K2…KN+1) — see docs §2's coherence mechanism.
	 * Presence/absence selects the model variant.
	 */
	inputUrls?: string[];
	resolution?: ImageResolution;
	callBackUrl?: string;
}

export async function generateImage(
	input: GenerateImageInput,
): Promise<CreateTaskResult> {
	const { prompt, aspectRatio, inputUrls, resolution, callBackUrl } = input;

	if (inputUrls && inputUrls.length > MAX_IMAGE_INPUT_URLS) {
		throw new KieError(
			`generateImage accepts at most ${MAX_IMAGE_INPUT_URLS} input_urls (got ${inputUrls.length})`,
			{ status: 400 },
		);
	}

	const hasReferenceImages = !!inputUrls && inputUrls.length > 0;

	return createTask({
		model: hasReferenceImages ? IMAGE_TO_IMAGE_MODEL : TEXT_TO_IMAGE_MODEL,
		callBackUrl,
		input: {
			prompt,
			aspect_ratio: aspectRatio,
			...(resolution ? { resolution } : {}),
			...(hasReferenceImages ? { input_urls: inputUrls } : {}),
		},
	});
}
