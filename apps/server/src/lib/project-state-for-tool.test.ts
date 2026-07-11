import { describe, expect, test } from "bun:test";

import {
	buildProjectStateForTool,
	type ProjectStateForToolProject,
	type ProjectStateForToolScene,
} from "./project-state-for-tool";

function scene(
	overrides: Partial<ProjectStateForToolScene> & { id: string },
): ProjectStateForToolScene {
	return {
		dialogue: null,
		durationSeconds: 8,
		failReason: null,
		prompt: "a scene prompt",
		speakerName: null,
		status: "planned",
		title: "Untitled",
		...overrides,
	};
}

function project(
	overrides: Partial<ProjectStateForToolProject> = {},
): ProjectStateForToolProject {
	return {
		audioLanguage: "en",
		draftTimeline: [],
		plan: null,
		status: "ready",
		subtitleLanguage: "en",
		synopsis: "A synopsis.",
		title: "A title",
		...overrides,
	};
}

function timelineEntry(sceneId: string) {
	return { sceneId, videoAssetId: "", durationSeconds: 8 };
}

describe("buildProjectStateForTool — scene ordering", () => {
	test("scenes out of draftTimeline order get reordered to match the timeline", () => {
		const scenes = [
			scene({ id: "s1" }),
			scene({ id: "s2" }),
			scene({ id: "s3" }),
		];
		const state = buildProjectStateForTool(
			project({
				draftTimeline: [
					timelineEntry("s3"),
					timelineEntry("s1"),
					timelineEntry("s2"),
				],
			}),
			scenes,
		);
		expect(state.scenes.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
	});

	test("scenes missing from the timeline are appended after the timeline-ordered scenes", () => {
		const scenes = [
			scene({ id: "s1" }),
			scene({ id: "orphan" }),
			scene({ id: "s2" }),
		];
		const state = buildProjectStateForTool(
			project({ draftTimeline: [timelineEntry("s2"), timelineEntry("s1")] }),
			scenes,
		);
		expect(state.scenes.map((s) => s.id)).toEqual(["s2", "s1", "orphan"]);
	});

	test("a timeline entry with no matching scene row is skipped, not a hole", () => {
		const scenes = [scene({ id: "s1" })];
		const state = buildProjectStateForTool(
			project({
				draftTimeline: [timelineEntry("deleted-scene"), timelineEntry("s1")],
			}),
			scenes,
		);
		expect(state.scenes.map((s) => s.id)).toEqual(["s1"]);
	});
});

describe("buildProjectStateForTool — truncation boundaries", () => {
	test("a prompt exactly at the 240-char cap is left untouched", () => {
		const exact = "p".repeat(240);
		const state = buildProjectStateForTool(project(), [
			scene({ id: "s1", prompt: exact }),
		]);
		expect(state.scenes[0]?.prompt).toBe(exact);
		expect(state.scenes[0]?.prompt.length).toBe(240);
	});

	test("a prompt one char over the cap is truncated with an ellipsis, staying at 240 chars", () => {
		const overLength = "p".repeat(241);
		const state = buildProjectStateForTool(project(), [
			scene({ id: "s1", prompt: overLength }),
		]);
		expect(state.scenes[0]?.prompt).toBe(`${"p".repeat(239)}…`);
		expect(state.scenes[0]?.prompt.length).toBe(240);
	});

	test("a visualDescription exactly at the 200-char cap is left untouched", () => {
		const exact = "d".repeat(200);
		const state = buildProjectStateForTool(
			project({
				plan: {
					characters: [
						{
							gender: undefined,
							name: "Hero",
							role: "lead",
							sheetAssetId: null,
							visualDescription: exact,
						},
					],
				},
			}),
			[],
		);
		expect(state.characters[0]?.visualDescription).toBe(exact);
	});

	test("a visualDescription one char over the 200-char cap is truncated with an ellipsis", () => {
		const overLength = "d".repeat(201);
		const state = buildProjectStateForTool(
			project({
				plan: {
					characters: [
						{
							gender: undefined,
							name: "Hero",
							role: "lead",
							sheetAssetId: null,
							visualDescription: overLength,
						},
					],
				},
			}),
			[],
		);
		expect(state.characters[0]?.visualDescription).toBe(`${"d".repeat(199)}…`);
		expect(state.characters[0]?.visualDescription.length).toBe(200);
	});
});

describe("buildProjectStateForTool — failReason", () => {
	test("failReason is surfaced for a failed scene", () => {
		const state = buildProjectStateForTool(project(), [
			scene({ id: "s1", failReason: "kie.ai timed out", status: "failed" }),
		]);
		expect(state.scenes[0]?.failReason).toBe("kie.ai timed out");
	});

	test("failReason is null for a non-failed scene even if the row carries a stale value", () => {
		const state = buildProjectStateForTool(project(), [
			scene({
				id: "s1",
				failReason: "stale reason from a previous failed attempt",
				status: "video_ready",
			}),
		]);
		expect(state.scenes[0]?.failReason).toBeNull();
	});

	test("failReason is null for every non-failed status, not just the happy path", () => {
		const state = buildProjectStateForTool(project(), [
			scene({ id: "s1", failReason: "x", status: "planned" }),
			scene({ id: "s2", failReason: "y", status: "keyframe_pending" }),
		]);
		expect(state.scenes.map((s) => s.failReason)).toEqual([null, null]);
	});
});
