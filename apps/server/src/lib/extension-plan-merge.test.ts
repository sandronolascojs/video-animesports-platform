import { describe, expect, test } from "bun:test";
import type {
	StoryPlanCharacter,
	StoryPlanLocation,
} from "@video-platform-challenge/api";
import { CharacterGender } from "@video-platform-challenge/types";

import {
	mergeExtensionCharacters,
	mergeExtensionLocation,
} from "./extension-plan-merge";

function existingCharacter(name: string) {
	return {
		name,
		role: "supporting",
		sheetAssetId: "asset-1",
		visualDescription: `${name}'s existing design`,
	};
}

function specCharacter(overrides: Partial<StoryPlanCharacter> = {}) {
	return {
		gender: CharacterGender.FEMALE,
		name: "Sofia",
		role: "rival",
		visualDescription: "Sharp bob, red scarf, confident stance.",
		...overrides,
	};
}

describe("mergeExtensionCharacters", () => {
	test("(a) the agent specs 2 newCharacters -> both are merged, no placeholder", () => {
		const specced = [
			specCharacter({ name: "Sofia" }),
			specCharacter({ name: "Dario", gender: CharacterGender.MALE }),
		];
		const result = mergeExtensionCharacters([], ["Sofia", "Dario"], specced);
		expect(result.placeholderCharacterNames).toEqual([]);
		expect(result.characters).toEqual([
			{
				gender: CharacterGender.FEMALE,
				name: "Sofia",
				role: "rival",
				sheetAssetId: null,
				visualDescription: "Sharp bob, red scarf, confident stance.",
			},
			{
				gender: CharacterGender.MALE,
				name: "Dario",
				role: "rival",
				sheetAssetId: null,
				visualDescription: "Sharp bob, red scarf, confident stance.",
			},
		]);
	});

	test("(b) the scene references an unknown character NOT specced -> placeholder fallback used and reported", () => {
		const result = mergeExtensionCharacters([], ["Mystery Man"], undefined);
		expect(result.placeholderCharacterNames).toEqual(["Mystery Man"]);
		expect(result.characters).toEqual([
			{
				name: "Mystery Man",
				role: "supporting",
				sheetAssetId: null,
				visualDescription:
					"A character named Mystery Man, introduced in a story extension — keep them consistent with the project's existing style bible.",
			},
		]);
	});

	test("(e) a newCharacter name colliding with an existing plan character -> existing wins (no dupe)", () => {
		const existing = [existingCharacter("Sofia")];
		const specced = [specCharacter({ name: "Sofia", role: "brand-new-role" })];
		const result = mergeExtensionCharacters(existing, ["Sofia"], specced);
		expect(result.placeholderCharacterNames).toEqual([]);
		expect(result.characters).toEqual(existing);
		expect(result.characters).toHaveLength(1);
	});

	test("a referenced name already merged earlier in the same pass is not re-added or re-placeholdered", () => {
		const result = mergeExtensionCharacters(
			[],
			["Mystery Man", "Mystery Man"],
			undefined,
		);
		expect(result.characters).toHaveLength(1);
		expect(result.placeholderCharacterNames).toEqual(["Mystery Man"]);
	});

	test("an unreferenced newCharacters entry is never merged", () => {
		const specced = [specCharacter({ name: "Unused" })];
		const result = mergeExtensionCharacters([], [], specced);
		expect(result.characters).toEqual([]);
		expect(result.placeholderCharacterNames).toEqual([]);
	});
});

describe("mergeExtensionLocation", () => {
	const existingLocation = {
		description: "An existing arena.",
		key: "stadium",
		name: "The Stadium",
		sheetAssetId: "asset-2",
		timeOfDay: "day",
	};

	function specLocation(overrides: Partial<StoryPlanLocation> = {}) {
		return {
			description: "A quiet locker room.",
			key: "locker-room",
			name: "Locker Room",
			timeOfDay: "night",
			...overrides,
		};
	}

	test("an already-existing location key is reused, no placeholder", () => {
		const result = mergeExtensionLocation(
			[existingLocation],
			"stadium",
			undefined,
		);
		expect(result.placeholderLocationKey).toBeNull();
		expect(result.locations).toEqual([existingLocation]);
	});

	test("(c) newLocation.key matches the scene's locationKey -> used", () => {
		const specced = specLocation({ key: "locker-room" });
		const result = mergeExtensionLocation([], "locker-room", specced);
		expect(result.placeholderLocationKey).toBeNull();
		expect(result.locations).toEqual([
			{
				description: "A quiet locker room.",
				key: "locker-room",
				name: "Locker Room",
				sheetAssetId: null,
				timeOfDay: "night",
			},
		]);
	});

	test("(d) newLocation.key mismatch -> placeholder fallback", () => {
		const specced = specLocation({ key: "some-other-key" });
		const result = mergeExtensionLocation([], "locker-room", specced);
		expect(result.placeholderLocationKey).toBe("locker-room");
		expect(result.locations).toEqual([
			{
				description:
					"A location introduced in a story extension (locker-room) — keep it consistent with the project's existing style bible.",
				key: "locker-room",
				name: "locker-room",
				sheetAssetId: null,
				timeOfDay: "day",
			},
		]);
	});

	test("no newLocation at all for an unknown key -> placeholder fallback", () => {
		const result = mergeExtensionLocation([], "locker-room", undefined);
		expect(result.placeholderLocationKey).toBe("locker-room");
		expect(result.locations[0]?.name).toBe("locker-room");
	});
});
