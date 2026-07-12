import { describe, expect, test } from "bun:test";

import { type ProjectEvent, projectEventSchema } from "./project-event";

describe("projectEventSchema", () => {
	test("parses a valid scene event", () => {
		const event: ProjectEvent = {
			type: "scene",
			projectId: "project_1",
			sceneId: "scene_1",
			status: "video_ready",
			at: 1_720_000_000_000,
		};
		expect(projectEventSchema.parse(event)).toEqual(event);
	});

	test("parses a valid project event", () => {
		const event: ProjectEvent = {
			type: "project",
			projectId: "project_1",
			status: "ready",
			at: 1_720_000_000_000,
		};
		expect(projectEventSchema.parse(event)).toEqual(event);
	});

	test("parses a valid version event", () => {
		const event: ProjectEvent = {
			type: "version",
			projectId: "project_1",
			versionId: "version_1",
			status: "rendering",
			at: 1_720_000_000_000,
		};
		expect(projectEventSchema.parse(event)).toEqual(event);
	});

	test("rejects an unknown discriminant", () => {
		const result = projectEventSchema.safeParse({
			type: "asset",
			projectId: "project_1",
			at: 1,
		});
		expect(result.success).toBe(false);
	});

	test("rejects a scene event with an invalid status", () => {
		const result = projectEventSchema.safeParse({
			type: "scene",
			projectId: "project_1",
			sceneId: "scene_1",
			status: "not-a-real-status",
			at: 1,
		});
		expect(result.success).toBe(false);
	});

	test("rejects a version event missing versionId", () => {
		const result = projectEventSchema.safeParse({
			type: "version",
			projectId: "project_1",
			status: "ready",
			at: 1,
		});
		expect(result.success).toBe(false);
	});
});
