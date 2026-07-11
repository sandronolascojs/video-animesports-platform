import { describe, expect, test } from "bun:test";

import {
	extendStorySceneSchema,
	type StoryPlanKeyframe,
	type StoryPlanScene,
} from "./story";

const scene: StoryPlanScene = {
	characterNames: ["Kaito"],
	cinematography: {
		cameraMotion: "push-in",
		motionNotes: "Impact frame on contact.",
		pacing: "frantic",
	},
	dialogue: "Take this!",
	durationSeconds: 8,
	locationKey: "stadium",
	prompt: "Kaito strikes the penalty into the top corner.",
	speaker: "Kaito",
	subtitleText: "Take this!",
	title: "The Strike",
};

const keyframe: StoryPlanKeyframe = {
	cameraAngle: "low-angle",
	charactersPresent: ["Kaito"],
	description: "Kaito plants his foot, mid-strike toward the ball.",
	locationKey: "stadium",
	shotScale: "close-up",
};

const newCharacter = {
	gender: "male",
	name: "Renji",
	role: "rival goalkeeper",
	visualDescription:
		"Tall, silver undercut hair, teal goalkeeper kit #1, a scar over one eyebrow.",
};

const newLocation = {
	description: "A cramped locker room, steam from the showers, lockers ajar.",
	key: "locker-room",
	name: "Away Team Locker Room",
	timeOfDay: "evening",
};

describe("extendStorySceneSchema", () => {
	test("accepts the minimal shape with no newCharacters/newLocation", () => {
		const result = extendStorySceneSchema.safeParse({ keyframe, scene });
		expect(result.success).toBe(true);
	});

	test("accepts newCharacters fully specified", () => {
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newCharacters: [newCharacter],
			scene,
		});
		expect(result.success).toBe(true);
	});

	test("accepts newLocation fully specified", () => {
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newLocation,
			scene,
		});
		expect(result.success).toBe(true);
	});

	test("accepts both newCharacters and newLocation together", () => {
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newCharacters: [newCharacter],
			newLocation,
			scene,
		});
		expect(result.success).toBe(true);
	});

	test("rejects more than 2 newCharacters", () => {
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newCharacters: [
				newCharacter,
				{ ...newCharacter, name: "Second" },
				{ ...newCharacter, name: "Third" },
			],
			scene,
		});
		expect(result.success).toBe(false);
	});

	test("rejects a newCharacters entry missing a required field (visualDescription)", () => {
		const { visualDescription, ...incomplete } = newCharacter;
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newCharacters: [incomplete],
			scene,
		});
		expect(result.success).toBe(false);
	});

	test("rejects a newLocation missing a required field (timeOfDay)", () => {
		const { timeOfDay, ...incomplete } = newLocation;
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newLocation: incomplete,
			scene,
		});
		expect(result.success).toBe(false);
	});

	test("rejects an invalid gender on a newCharacters entry", () => {
		const result = extendStorySceneSchema.safeParse({
			keyframe,
			newCharacters: [{ ...newCharacter, gender: "unknown" }],
			scene,
		});
		expect(result.success).toBe(false);
	});
});
