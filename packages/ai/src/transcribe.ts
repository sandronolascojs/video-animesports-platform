// Subtitle STT (docs media-ops-container.md §Feature 2) — transcribes a
// scene's video via the AI Gateway's `openai/whisper-1` (model-ids.ts's
// `TRANSCRIPTION_MODEL`). Swapped in for kie's `elevenlabs/speech-to-text`,
// which is 401 UNAUTHORIZED for this account's key (verified against the
// live API, same failure mode as the ElevenLabs TTS removed earlier).
//
// mp4 is a supported whisper input — the audio track is extracted
// provider-side, no ffmpeg needed — confirmed via
// packages/ai/evals/transcribe-check.ts: transcribing a seedance clip (video
// + audio) returned real segment timestamps and durationInSeconds. Reuses the
// SAME gateway client this package already builds for the plan/extend/studio
// agents (models.ts's `createAiGateway`) — no second client, no new env var.
import type { SpeechCue } from "@video-platform-challenge/types";
import { experimental_transcribe as transcribe } from "ai";

import { TRANSCRIPTION_MODEL } from "./model-ids";
import { createAiGateway } from "./models";
import { segmentsToSpeechCues } from "./transcribe-result";

export { segmentsToSpeechCues } from "./transcribe-result";

/**
 * Transcribes raw audio/video bytes into speech-timed subtitle cues. Callers
 * decide best-effort semantics (never throw vs. degrade) — this function
 * itself lets a transcription failure propagate.
 */
export async function transcribeSpeech(
	audio: Uint8Array,
): Promise<SpeechCue[]> {
	const gateway = createAiGateway();
	const model = gateway.transcription(TRANSCRIPTION_MODEL);
	const result = await transcribe({
		model,
		audio,
		providerOptions: {
			openai: { timestampGranularities: ["word", "segment"] },
		},
	});
	return segmentsToSpeechCues(result.segments);
}
