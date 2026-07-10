import { describe, expect, test } from "bun:test";

import { pickCharacterVoice, VOICE_POOLS } from "./constants";
import { AudioLanguage, CharacterGender } from "./enums";

const LANGUAGES = Object.values(AudioLanguage);
const GENDERS = Object.values(CharacterGender);

describe("pickCharacterVoice", () => {
	test("is deterministic: same inputs always pick the same voice", () => {
		for (const language of LANGUAGES) {
			for (const gender of GENDERS) {
				const args = {
					projectId: "proj-abc123",
					characterName: "Kaito Ishida",
					gender,
					language,
				};
				expect(pickCharacterVoice(args)).toBe(pickCharacterVoice(args));
			}
		}
	});

	test("always returns a voice from the language+gender pool", () => {
		const names = ["Messi", "Referee Tanaka", "Coach Diaz", "Aiko", "Bruno"];
		for (const language of LANGUAGES) {
			for (const gender of GENDERS) {
				const pool: readonly string[] = VOICE_POOLS[language][gender];
				for (const characterName of names) {
					const voice = pickCharacterVoice({
						projectId: "proj-xyz789",
						characterName,
						gender,
						language,
					});
					expect(pool).toContain(voice);
				}
			}
		}
	});

	test("distinct characters can land on different voices within one project", () => {
		// Deterministic (djb2 hash, fixed inputs): across enough names the
		// picks must cover more than one pool entry — the casting axis would
		// be pointless if every character collapsed onto the same voice.
		const names = [
			"Messi",
			"Goalkeeper Ivanov",
			"Referee Tanaka",
			"Coach Diaz",
			"Aiko",
			"Bruno",
			"Commentator Sato",
			"Captain Rojas",
			"Nurse Yamada",
			"Mister Petrov",
		];
		const voices = new Set(
			names.map((characterName) =>
				pickCharacterVoice({
					projectId: "proj-diversity",
					characterName,
					gender: CharacterGender.MALE,
					language: AudioLanguage.JAPANESE,
				}),
			),
		);
		expect(voices.size).toBeGreaterThan(1);
	});

	test("never returns undefined or an empty id", () => {
		const weirdNames = ["", "a", "🦊", "名前", "x".repeat(500)];
		for (const language of LANGUAGES) {
			for (const gender of GENDERS) {
				for (const characterName of weirdNames) {
					const voice = pickCharacterVoice({
						projectId: "proj-fallback",
						characterName,
						gender,
						language,
					});
					expect(typeof voice).toBe("string");
					expect(voice.length).toBeGreaterThan(0);
				}
			}
		}
	});
});
