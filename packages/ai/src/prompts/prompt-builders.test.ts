import { describe, expect, test } from "bun:test";
import type {
	ProjectPlanCharacter,
	ProjectPlanCinematography,
	ProjectPlanKeyframe,
	ProjectPlanLocation,
} from "@video-platform-challenge/types";
import {
	CameraAngle,
	CameraMotion,
	Pacing,
	ShotScale,
} from "@video-platform-challenge/types";

import {
	buildCharacterSheetPrompt,
	buildKeyframePrompt,
	buildLocationSheetPrompt,
	buildSceneVideoPrompt,
	compileCameraAngle,
	compileCameraMotion,
	compilePacing,
	compileShotScale,
	joinPromptSections,
} from "./prompt-builders";

const STYLE_BLOCK = "STYLE_BLOCK_MARKER\nconsistency clause";

describe("enum compilation", () => {
	test("compiles every ShotScale member to a non-empty phrase", () => {
		for (const value of Object.values(ShotScale)) {
			expect(compileShotScale(value).length).toBeGreaterThan(0);
		}
	});

	test("compiles every CameraAngle member to a non-empty phrase", () => {
		for (const value of Object.values(CameraAngle)) {
			expect(compileCameraAngle(value).length).toBeGreaterThan(0);
		}
	});

	test("compiles every CameraMotion member to a non-empty phrase", () => {
		for (const value of Object.values(CameraMotion)) {
			expect(compileCameraMotion(value).length).toBeGreaterThan(0);
		}
	});

	test("compiles every Pacing member to a non-empty phrase", () => {
		for (const value of Object.values(Pacing)) {
			expect(compilePacing(value).length).toBeGreaterThan(0);
		}
	});
});

describe("joinPromptSections", () => {
	test("joins truthy sections with newlines, skipping falsy ones", () => {
		expect(
			joinPromptSections(["a", "", "b", undefined, "c", null, false]),
		).toBe("a\nb\nc");
	});

	test("drops trailing lowest-priority sections once maxLength is exceeded", () => {
		const result = joinPromptSections(["keep-me", "also-keep", "drop-me"], 20);
		expect(result).toContain("keep-me");
		expect(result).toContain("also-keep");
		expect(result).not.toContain("drop-me");
	});

	test("never exceeds maxLength", () => {
		const result = joinPromptSections(
			["a".repeat(50), "b".repeat(50), "c".repeat(50)],
			60,
		);
		expect(result.length).toBeLessThanOrEqual(60);
	});
});

describe("buildCharacterSheetPrompt", () => {
	const character: ProjectPlanCharacter = {
		name: "Kaito",
		role: "protagonist",
		visualDescription: "Spiky black hair, red jersey #10.",
		sheetAssetId: null,
	};

	test("includes the style block, model-sheet craft, and canonical-design anchor", () => {
		const prompt = buildCharacterSheetPrompt(STYLE_BLOCK, character);
		expect(prompt).toContain(STYLE_BLOCK);
		expect(prompt).toContain("Anime character reference sheet");
		expect(prompt).toContain("Spiky black hair, red jersey #10.");
		expect(prompt).toContain(
			"This sheet is the canonical, binding design for Kaito across the entire episode",
		);
	});
});

describe("buildLocationSheetPrompt", () => {
	const location: ProjectPlanLocation = {
		key: "stadium",
		name: "National Stadium",
		description: "Packed stands, floodlights, rain-slicked pitch.",
		timeOfDay: "night",
		sheetAssetId: null,
	};

	test("includes the style block, background-painting craft, description, time of day and lighting", () => {
		const prompt = buildLocationSheetPrompt(
			STYLE_BLOCK,
			location,
			"Warm floodlight halation.",
		);
		expect(prompt).toContain(STYLE_BLOCK);
		expect(prompt).toContain("Anime background art");
		expect(prompt).toContain("Packed stands, floodlights, rain-slicked pitch.");
		expect(prompt).toContain("Time of day: night");
		expect(prompt).toContain("Lighting: Warm floodlight halation.");
	});
});

describe("buildKeyframePrompt", () => {
	const keyframe: ProjectPlanKeyframe = {
		description: "Kaito plants his foot, mid-strike toward the ball.",
		charactersPresent: ["Kaito"],
		locationKey: "stadium",
		shotScale: ShotScale.CLOSE_UP,
		cameraAngle: CameraAngle.LOW_ANGLE,
	};

	test("compiles shotScale/cameraAngle to camera language and includes the aggressive anchor clause", () => {
		const prompt = buildKeyframePrompt(
			STYLE_BLOCK,
			keyframe,
			"Packed stands, floodlights.",
		);
		expect(prompt).toContain(STYLE_BLOCK);
		expect(prompt).toContain(compileShotScale(ShotScale.CLOSE_UP));
		expect(prompt).toContain(compileCameraAngle(CameraAngle.LOW_ANGLE));
		expect(prompt).toContain(
			"Kaito plants his foot, mid-strike toward the ball.",
		);
		expect(prompt).toContain("Location: Packed stands, floodlights.");
		expect(prompt).toContain("Characters in frame: Kaito.");
		expect(prompt).toContain("Match EXACTLY the art style");
		expect(prompt).toContain("Do not reinterpret, do not restyle");
	});

	test("says 'no characters in frame' when charactersPresent is empty", () => {
		const prompt = buildKeyframePrompt(
			STYLE_BLOCK,
			{ ...keyframe, charactersPresent: [] },
			undefined,
		);
		expect(prompt).toContain("No characters in frame.");
		expect(prompt).not.toContain("Location:");
	});

	// AI-6a §8d: the consistency clause used to sit LAST — the first thing
	// `joinPromptSections` drops on overflow — even though it's what the
	// whole coherence mechanism depends on. It now sits directly after the
	// style block.
	test("the consistency clause survives overflow with max-length inputs, even when later sections get dropped", () => {
		const hugeStyleBlock = "S".repeat(3000);
		const hugeKeyframe: ProjectPlanKeyframe = {
			...keyframe,
			description: "D".repeat(600),
			charactersPresent: ["Kaito", "Renji", "Souta", "Yuki", "Hana", "Mio"],
		};
		const hugeLocationDescription = "L".repeat(600);
		const manySheetlessCharacters = Array.from({ length: 5 }, (_, i) => ({
			name: `Extra${i}`,
			visualDescription: "V".repeat(600),
		}));

		const prompt = buildKeyframePrompt(
			hugeStyleBlock,
			hugeKeyframe,
			hugeLocationDescription,
			manySheetlessCharacters,
		);

		expect(prompt.length).toBeLessThanOrEqual(6000);
		expect(prompt).toContain(hugeStyleBlock);
		expect(prompt).toContain("Match EXACTLY the art style");
		expect(prompt).toContain("Do not reinterpret, do not restyle");
		// Overflow forces something to drop — with everything else maxed out,
		// the lowest-priority sheetless-fallback text is what's sacrificed
		// first, never the consistency clause.
		expect(prompt).not.toContain("V".repeat(600));
	});

	// AI-6a §8d: a character present in this keyframe whose sheet URL the
	// caller couldn't resolve gets their visualDescription appended as a
	// textual fallback, instead of the prompt silently losing their design.
	describe("sheetless-character fallback", () => {
		test("appends the fallback text with the character's visualDescription when sheetless characters are given", () => {
			const prompt = buildKeyframePrompt(
				STYLE_BLOCK,
				keyframe,
				"Packed stands, floodlights.",
				[
					{
						name: "Kaito",
						visualDescription: "Spiky black hair, red jersey #10.",
					},
				],
			);
			expect(prompt).toContain("No reference sheet is available yet for");
			expect(prompt).toContain("Kaito (Spiky black hair, red jersey #10.)");
		});

		test("omits the fallback section entirely when no sheetless characters are given", () => {
			const prompt = buildKeyframePrompt(
				STYLE_BLOCK,
				keyframe,
				"Packed stands, floodlights.",
			);
			expect(prompt).not.toContain("No reference sheet is available yet for");
		});
	});
});

describe("buildSceneVideoPrompt", () => {
	const cinematography: ProjectPlanCinematography = {
		cameraMotion: CameraMotion.PUSH_IN,
		motionNotes: "Two impact frames on contact, then a held reaction beat.",
		pacing: Pacing.FRANTIC,
	};

	test("compiles cinematography and includes the fencing/no-morphing clause", () => {
		const prompt = buildSceneVideoPrompt(
			STYLE_BLOCK,
			cinematography,
			"Kaito strikes the penalty into the top corner.",
		);
		expect(prompt).toContain(STYLE_BLOCK);
		expect(prompt).toContain(compileCameraMotion(CameraMotion.PUSH_IN));
		expect(prompt).toContain(compilePacing(Pacing.FRANTIC));
		expect(prompt).toContain("Kaito strikes the penalty into the top corner.");
		expect(prompt).toContain(
			"Two impact frames on contact, then a held reaction beat.",
		);
		expect(prompt).toContain("No morphing, no flicker, no style drift");
		expect(prompt).toContain("One single continuous shot");
	});

	test("omits the spoken-dialogue clause when no dialogue is passed", () => {
		const prompt = buildSceneVideoPrompt(
			STYLE_BLOCK,
			cinematography,
			"Kaito strikes the penalty into the top corner.",
		);
		expect(prompt).not.toContain("Spoken dialogue:");
	});

	test("includes the exact spoken-aloud wording when dialogue is present", () => {
		const prompt = buildSceneVideoPrompt(
			STYLE_BLOCK,
			cinematography,
			"Kaito strikes the penalty into the top corner.",
			"Take this, keeper!",
		);
		expect(prompt).toContain(
			'Spoken dialogue: the character speaks these exact words aloud in the scene: "Take this, keeper!"',
		);
	});

	test("prefixes the dialogue clause with the speaker name when given", () => {
		const prompt = buildSceneVideoPrompt(
			STYLE_BLOCK,
			cinematography,
			"Kaito strikes the penalty into the top corner.",
			"Take this, keeper!",
			"Kaito",
		);
		expect(prompt).toContain(
			'Spoken dialogue: the character (Kaito) speaks these exact words aloud in the scene: "Take this, keeper!"',
		);
	});

	test("omits the spoken-dialogue clause when dialogue is blank even if a speaker name is given", () => {
		const prompt = buildSceneVideoPrompt(
			STYLE_BLOCK,
			cinematography,
			"Kaito strikes the penalty into the top corner.",
			"   ",
			"Kaito",
		);
		expect(prompt).not.toContain("Spoken dialogue:");
	});

	// AI-6a §8d: same reorder as buildKeyframePrompt — the no-morphing/
	// on-model consistency clause used to sit last (dropped first on
	// overflow); it now sits directly after the style block.
	test("the no-morphing consistency clause survives overflow with max-length inputs", () => {
		const hugeStyleBlock = "S".repeat(3000);
		const prompt = buildSceneVideoPrompt(
			hugeStyleBlock,
			cinematography,
			"A".repeat(1000),
			"D".repeat(500),
			"Kaito",
		);
		expect(prompt.length).toBeLessThanOrEqual(6000);
		expect(prompt).toContain(hugeStyleBlock);
		expect(prompt).toContain("No morphing, no flicker, no style drift");
		expect(prompt).toContain("One single continuous shot");
	});
});
