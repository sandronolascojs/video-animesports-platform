import { describe, expect, test } from "bun:test";
import type { Scene, TimelineEntry } from "@video-platform-challenge/api";
import { SceneStatus } from "@video-platform-challenge/types";

import {
	findActiveScene,
	STUDIO_FPS,
	timelineDurationInFrames,
} from "./composition";

function makeEntry(sceneId: string, durationSeconds: number): TimelineEntry {
	return { durationSeconds, sceneId, videoAssetId: `${sceneId}-video` };
}

function makeScene(id: string, overrides: Partial<Scene> = {}): Scene {
	return {
		createdAt: new Date(),
		dialogue: null,
		durationSeconds: 5,
		endKeyframeAssetId: null,
		failReason: null,
		id,
		prompt: `Prompt for ${id}`,
		projectId: "project-1",
		speakerName: null,
		startKeyframeAssetId: null,
		status: SceneStatus.VIDEO_READY,
		subtitleText: null,
		title: id,
		updatedAt: new Date(),
		videoAssetId: null,
		...overrides,
	};
}

describe("timelineDurationInFrames", () => {
	test("clamps an empty timeline to 1 frame (the Player NaN guard's precondition)", () => {
		expect(timelineDurationInFrames([], STUDIO_FPS)).toBe(1);
	});

	test("converts a single scene's duration to frames at the given fps", () => {
		const timeline = [makeEntry("scene-1", 2)];
		expect(timelineDurationInFrames(timeline, STUDIO_FPS)).toBe(60);
	});

	test("sums every scene's duration across a multi-scene timeline", () => {
		const timeline = [
			makeEntry("scene-1", 2),
			makeEntry("scene-2", 3),
			makeEntry("scene-3", 1.5),
		];
		expect(timelineDurationInFrames(timeline, STUDIO_FPS)).toBe(195);
	});
});

describe("findActiveScene", () => {
	test("returns null for an empty timeline", () => {
		expect(findActiveScene([], {}, 0, STUDIO_FPS)).toBeNull();
	});

	test("returns the only scene for a single-scene timeline", () => {
		const timeline = [makeEntry("scene-1", 2)];
		const scenesById = { "scene-1": makeScene("scene-1") };
		expect(findActiveScene(timeline, scenesById, 0, STUDIO_FPS)?.id).toBe(
			"scene-1",
		);
	});

	test("a frame exactly on a scene boundary belongs to the NEXT scene (end is exclusive)", () => {
		// scene-1 spans frames [0, 60); scene-2 starts exactly at frame 60.
		const timeline = [makeEntry("scene-1", 2), makeEntry("scene-2", 2)];
		const scenesById = {
			"scene-1": makeScene("scene-1"),
			"scene-2": makeScene("scene-2"),
		};
		expect(findActiveScene(timeline, scenesById, 60, STUDIO_FPS)?.id).toBe(
			"scene-2",
		);
		expect(findActiveScene(timeline, scenesById, 59, STUDIO_FPS)?.id).toBe(
			"scene-1",
		);
	});

	test("selects the correct active scene across a multi-scene timeline", () => {
		const timeline = [
			makeEntry("scene-1", 2),
			makeEntry("scene-2", 3),
			makeEntry("scene-3", 1),
		];
		const scenesById = {
			"scene-1": makeScene("scene-1"),
			"scene-2": makeScene("scene-2"),
			"scene-3": makeScene("scene-3"),
		};
		// scene-1: [0, 60), scene-2: [60, 150), scene-3: [150, 180)
		expect(findActiveScene(timeline, scenesById, 0, STUDIO_FPS)?.id).toBe(
			"scene-1",
		);
		expect(findActiveScene(timeline, scenesById, 100, STUDIO_FPS)?.id).toBe(
			"scene-2",
		);
		expect(findActiveScene(timeline, scenesById, 175, STUDIO_FPS)?.id).toBe(
			"scene-3",
		);
	});

	test("returns null past the end of the timeline", () => {
		const timeline = [makeEntry("scene-1", 1)];
		const scenesById = { "scene-1": makeScene("scene-1") };
		expect(findActiveScene(timeline, scenesById, 30, STUDIO_FPS)).toBeNull();
	});

	test("returns null when the active entry's scene id is missing from scenesById", () => {
		const timeline = [makeEntry("scene-1", 1)];
		expect(findActiveScene(timeline, {}, 0, STUDIO_FPS)).toBeNull();
	});
});
