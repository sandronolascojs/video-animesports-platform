import { describe, expect, test } from "bun:test";
import type { ProjectPlan } from "@video-platform-challenge/types";
import {
	CameraAngle,
	CameraMotion,
	Pacing,
	ShotScale,
} from "@video-platform-challenge/types";

import { normalizeProjectPlan } from "./plan-compat";

const SCENES = [
	{ id: "scene-1", prompt: "Kaito lines up the penalty." },
	{ id: "scene-2", prompt: "The referee blows the whistle." },
	{ id: "scene-3", prompt: "The ball hits the net." },
];

const NEW_SHAPE_PLAN: ProjectPlan = {
	styleBibleSpec: {
		artDirection: "a",
		lineArt: "b",
		colorScript: "c",
		characterRendering: "d",
		lighting: "custom lighting rule",
		cameraGrammar: "f",
		filmTexture: "g",
		motionLanguage: "h",
	},
	characters: [],
	locations: [],
	scenes: SCENES.map((scene) => ({
		sceneId: scene.id,
		characterNames: ["Kaito"],
		locationKey: "stadium",
		cinematography: {
			cameraMotion: CameraMotion.TRACKING,
			motionNotes: "existing notes",
			pacing: Pacing.FRANTIC,
		},
	})),
	keyframes: Array.from({ length: 4 }, (_, i) => ({
		description: `keyframe ${i}`,
		charactersPresent: ["Kaito"],
		locationKey: "stadium",
		shotScale: ShotScale.WIDE,
		cameraAngle: CameraAngle.DUTCH,
	})),
};

// Simulates a pre-upgrade dev-era row: no styleBibleSpec, no keyframes, no
// per-scene cinematography — exactly the shape the OLD plan agent produced.
const OLD_SHAPE_PLAN = {
	characters: [],
	locations: [],
	scenes: SCENES.map((scene) => ({
		sceneId: scene.id,
		characterNames: ["Kaito"],
		locationKey: "stadium",
	})),
} as unknown as ProjectPlan;

describe("normalizeProjectPlan", () => {
	test("N+1 chain math: keyframes always has sceneCount + KEYFRAME_COUNT_OFFSET entries", () => {
		const normalized = normalizeProjectPlan(OLD_SHAPE_PLAN, SCENES);
		expect(normalized.keyframes).toHaveLength(SCENES.length + 1);
	});

	test("passes through an already-structured plan unchanged", () => {
		const normalized = normalizeProjectPlan(NEW_SHAPE_PLAN, SCENES);
		expect(normalized.styleBibleSpec.lighting).toBe("custom lighting rule");
		expect(normalized.keyframes).toEqual(NEW_SHAPE_PLAN.keyframes);
		expect(normalized.scenes[0]?.cinematography).toEqual(
			NEW_SHAPE_PLAN.scenes[0]?.cinematography,
		);
	});

	test("fills a missing styleBibleSpec with a safe default", () => {
		const normalized = normalizeProjectPlan(OLD_SHAPE_PLAN, SCENES);
		expect(normalized.styleBibleSpec).toBeTruthy();
		expect(typeof normalized.styleBibleSpec.lighting).toBe("string");
		expect(normalized.styleBibleSpec.lighting.length).toBeGreaterThan(0);
	});

	test("synthesizes missing keyframes from the governing scene's prompt", () => {
		const normalized = normalizeProjectPlan(OLD_SHAPE_PLAN, SCENES);
		// K1 governs scene 1, K2 governs scene 2, K3 governs scene 3, K4 (the
		// trailing end-only anchor) also borrows scene 3 (docs §2's documented
		// simplification, mirrored here).
		expect(normalized.keyframes[0]?.description).toBe(
			"Kaito lines up the penalty.",
		);
		expect(normalized.keyframes[1]?.description).toBe(
			"The referee blows the whistle.",
		);
		expect(normalized.keyframes[2]?.description).toBe("The ball hits the net.");
		expect(normalized.keyframes[3]?.description).toBe("The ball hits the net.");
	});

	test("defaults synthesized keyframes to a neutral medium/eye-level camera", () => {
		const normalized = normalizeProjectPlan(OLD_SHAPE_PLAN, SCENES);
		for (const keyframe of normalized.keyframes) {
			expect(keyframe.shotScale).toBe(ShotScale.MEDIUM);
			expect(keyframe.cameraAngle).toBe(CameraAngle.EYE_LEVEL);
		}
	});

	test("fills missing per-scene cinematography with a neutral static/building default", () => {
		const normalized = normalizeProjectPlan(OLD_SHAPE_PLAN, SCENES);
		expect(normalized.scenes[0]?.cinematography).toEqual({
			cameraMotion: CameraMotion.STATIC,
			motionNotes: "Kaito lines up the penalty.",
			pacing: Pacing.BUILDING,
		});
	});

	test("treats a wrong-length keyframes array as old-shape and resynthesizes it fully", () => {
		const wrongLength: ProjectPlan = {
			...NEW_SHAPE_PLAN,
			keyframes: NEW_SHAPE_PLAN.keyframes.slice(0, 2),
		};
		const normalized = normalizeProjectPlan(wrongLength, SCENES);
		expect(normalized.keyframes).toHaveLength(4);
		expect(normalized.keyframes[0]?.description).toBe(
			"Kaito lines up the penalty.",
		);
	});
});
