import { describe, expect, test } from "bun:test";
import type { ProjectPlanCharacter } from "@video-platform-challenge/types";
import {
	AudioLanguage,
	CharacterGender,
	pickCharacterVoice,
	TTS_VOICE_BY_LANGUAGE,
	VOICE_POOLS,
} from "@video-platform-challenge/types";

import { resolveSceneVoice } from "./scene-voice";

const PROJECT_ID = "proj-test-1";

function character(
	overrides: Partial<ProjectPlanCharacter> & { name: string },
): ProjectPlanCharacter {
	return {
		role: "protagonist",
		visualDescription: "A test character.",
		sheetAssetId: null,
		...overrides,
	};
}

const CHARACTERS: ProjectPlanCharacter[] = [
	character({ name: "Messi", gender: CharacterGender.MALE }),
	character({ name: "Aiko", gender: CharacterGender.FEMALE }),
	// Legacy plan entry predating the gender field (or a defensively-created
	// extension character) — no gender.
	character({ name: "Mystery Coach" }),
];

describe("resolveSceneVoice", () => {
	test("gendered speaker resolves to their fixed pool voice", () => {
		const voice = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: "Messi",
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.JAPANESE,
		});
		expect(voice).toBe(
			pickCharacterVoice({
				projectId: PROJECT_ID,
				characterName: "Messi",
				gender: CharacterGender.MALE,
				language: AudioLanguage.JAPANESE,
			}),
		);
		// Widened: VOICE_POOLS entries are as-const literal tuples, whose
		// element union does not unify with the plain `string` this helper
		// returns under toContain's overloads.
		const jaMalePool: readonly string[] = VOICE_POOLS.ja.male;
		expect(jaMalePool).toContain(voice);
	});

	test("respects the speaker's gender pool per language", () => {
		const voice = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: "Aiko",
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.ENGLISH,
		});
		const enFemalePool: readonly string[] = VOICE_POOLS.en.female;
		expect(enFemalePool).toContain(voice);
	});

	test("unknown speaker (not in the plan) falls back to the language default", () => {
		const voice = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: "Someone Never Planned",
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.JAPANESE,
		});
		expect(voice).toBe(TTS_VOICE_BY_LANGUAGE.ja);
	});

	test("legacy character without gender falls back to the language default", () => {
		const voice = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: "Mystery Coach",
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.ENGLISH,
		});
		expect(voice).toBe(TTS_VOICE_BY_LANGUAGE.en);
	});

	test("silent/unattributed scene (null speakerName) falls back to the language default", () => {
		const voice = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: null,
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.JAPANESE,
		});
		expect(voice).toBe(TTS_VOICE_BY_LANGUAGE.ja);
	});

	test("same speaker gets the same voice across repeated scenes", () => {
		const first = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: "Messi",
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.JAPANESE,
		});
		const second = resolveSceneVoice({
			projectId: PROJECT_ID,
			speakerName: "Messi",
			characters: CHARACTERS,
			audioLanguage: AudioLanguage.JAPANESE,
		});
		expect(second).toBe(first);
	});
});
