import { describe, expect, test } from "bun:test";

import {
	INITIAL_SCENE_COUNT,
	MAX_SCENE_DURATION_SECONDS,
	MAX_SCENES_PER_GENERATION,
	MIN_SCENE_DURATION_SECONDS,
	MIN_SCENES_PER_GENERATION,
} from "./constants";

describe("scene bounds", () => {
	test("MIN_SCENE_DURATION_SECONDS is less than MAX_SCENE_DURATION_SECONDS", () => {
		expect(MIN_SCENE_DURATION_SECONDS).toBeLessThan(MAX_SCENE_DURATION_SECONDS);
	});

	test("MIN_SCENES_PER_GENERATION is less than or equal to MAX_SCENES_PER_GENERATION", () => {
		expect(MIN_SCENES_PER_GENERATION).toBeLessThanOrEqual(
			MAX_SCENES_PER_GENERATION,
		);
	});

	test("INITIAL_SCENE_COUNT falls within the per-generation bounds", () => {
		expect(INITIAL_SCENE_COUNT).toBeGreaterThanOrEqual(
			MIN_SCENES_PER_GENERATION,
		);
		expect(INITIAL_SCENE_COUNT).toBeLessThanOrEqual(MAX_SCENES_PER_GENERATION);
	});
});
