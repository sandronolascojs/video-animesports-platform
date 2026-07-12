import { describe, expect, test } from "bun:test";
import { ProjectStatus, SceneStatus } from "@video-platform-challenge/types";

import { canRenderProject } from "./render-guard";

function scene(status: SceneStatus) {
	return { status };
}

describe("canRenderProject", () => {
	test("project ready + every scene video_ready -> allowed", () => {
		expect(
			canRenderProject(ProjectStatus.READY, [
				scene(SceneStatus.VIDEO_READY),
				scene(SceneStatus.VIDEO_READY),
			]),
		).toBe(true);
	});

	test("empty scenes -> blocked, even if the project is ready", () => {
		expect(canRenderProject(ProjectStatus.READY, [])).toBe(false);
	});

	test("one scene still planned -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.READY, [
				scene(SceneStatus.VIDEO_READY),
				scene(SceneStatus.PLANNED),
			]),
		).toBe(false);
	});

	test("one scene keyframe_pending -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.READY, [
				scene(SceneStatus.VIDEO_READY),
				scene(SceneStatus.KEYFRAME_PENDING),
			]),
		).toBe(false);
	});

	test("one scene keyframe_ready -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.READY, [
				scene(SceneStatus.VIDEO_READY),
				scene(SceneStatus.KEYFRAME_READY),
			]),
		).toBe(false);
	});

	test("one scene video_pending -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.READY, [
				scene(SceneStatus.VIDEO_READY),
				scene(SceneStatus.VIDEO_PENDING),
			]),
		).toBe(false);
	});

	test("one scene failed -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.READY, [
				scene(SceneStatus.VIDEO_READY),
				scene(SceneStatus.FAILED),
			]),
		).toBe(false);
	});

	test("project still generating, even with every existing scene video_ready -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.GENERATING, [
				scene(SceneStatus.VIDEO_READY),
			]),
		).toBe(false);
	});

	test("project failed -> blocked", () => {
		expect(
			canRenderProject(ProjectStatus.FAILED, [scene(SceneStatus.VIDEO_READY)]),
		).toBe(false);
	});
});
