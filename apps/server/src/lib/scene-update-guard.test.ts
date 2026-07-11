import { describe, expect, test } from "bun:test";
import { SceneStatus } from "@video-platform-challenge/types";

import { isLockedSceneFieldEdit } from "./scene-update-guard";

const NON_VIDEO_READY_STATUSES = [
	SceneStatus.PLANNED,
	SceneStatus.KEYFRAME_PENDING,
	SceneStatus.KEYFRAME_READY,
	SceneStatus.VIDEO_PENDING,
	SceneStatus.FAILED,
] as const;

describe("isLockedSceneFieldEdit", () => {
	describe("video_ready status — dialogue/duration locked, subtitleText/prompt free", () => {
		test("blocks a dialogue edit", () => {
			expect(
				isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {
					dialogue: "New line",
				}),
			).toBe(true);
		});

		test("blocks a durationSeconds edit", () => {
			expect(
				isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {
					durationSeconds: 8,
				}),
			).toBe(true);
		});

		test("blocks a combined dialogue + durationSeconds edit", () => {
			expect(
				isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {
					dialogue: "New line",
					durationSeconds: 8,
				}),
			).toBe(true);
		});

		test("allows a subtitleText-only edit", () => {
			expect(
				isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {
					subtitleText: "New caption",
				}),
			).toBe(false);
		});

		test("allows a prompt-only edit", () => {
			expect(
				isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {
					prompt: "New action description",
				}),
			).toBe(false);
		});

		test("allows a subtitleText + prompt combined edit (neither field is locked)", () => {
			expect(
				isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {
					prompt: "New action description",
					subtitleText: "New caption",
				}),
			).toBe(false);
		});

		test("allows an empty patch", () => {
			expect(isLockedSceneFieldEdit(SceneStatus.VIDEO_READY, {})).toBe(false);
		});
	});

	describe("every other status — dialogue/duration stay editable", () => {
		for (const status of NON_VIDEO_READY_STATUSES) {
			test(`${status}: allows a dialogue edit`, () => {
				expect(isLockedSceneFieldEdit(status, { dialogue: "New line" })).toBe(
					false,
				);
			});

			test(`${status}: allows a durationSeconds edit`, () => {
				expect(isLockedSceneFieldEdit(status, { durationSeconds: 8 })).toBe(
					false,
				);
			});

			test(`${status}: allows a combined dialogue + durationSeconds edit`, () => {
				expect(
					isLockedSceneFieldEdit(status, {
						dialogue: "New line",
						durationSeconds: 8,
					}),
				).toBe(false);
			});
		}
	});
});
