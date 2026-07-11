// Pure voice-resolution logic for a scene's TTS task (docs
// scenes-architecture-v3.md A3), extracted from generation.service.ts's
// `createSceneSpeechTask` for the same reason lib/fail-reason.ts exists:
// generation.service.ts imports env/db (`cloudflare:workers`), which cannot
// resolve under plain `bun test` — the testable implementation lives here,
// the service is the only caller.
import type {
	AudioLanguage,
	ProjectPlanCharacter,
} from "@video-platform-challenge/types";
import {
	pickCharacterVoice,
	TTS_VOICE_BY_LANGUAGE,
} from "@video-platform-challenge/types";

/**
 * Resolves the ElevenLabs voice id for a scene's dialogue (docs
 * scenes-architecture-v3.md "Voices are cast per character"): the scene's
 * `speakerName` resolves to a plan character, whose `gender` picks a FIXED,
 * deterministic voice from that language's pool (`pickCharacterVoice`,
 * hash(projectId:characterName)) — the same character always gets the same
 * voice, every scene and every re-run. Falls back to the flat per-language
 * default when the scene is unattributed (no speaker), the speaker isn't in
 * the plan, or the character predates the `gender` field (legacy plans and
 * extension-defaulted characters).
 */
export function resolveSceneVoice(args: {
	projectId: string;
	speakerName: string | null;
	characters: ProjectPlanCharacter[];
	audioLanguage: AudioLanguage;
}): string {
	const character = args.speakerName
		? args.characters.find((c) => c.name === args.speakerName)
		: undefined;
	return character?.gender
		? pickCharacterVoice({
				projectId: args.projectId,
				characterName: character.name,
				gender: character.gender,
				language: args.audioLanguage,
			})
		: TTS_VOICE_BY_LANGUAGE[args.audioLanguage];
}
