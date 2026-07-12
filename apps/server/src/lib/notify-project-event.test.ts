import { describe, expect, test } from "bun:test";
import type { ProjectEvent } from "@video-platform-challenge/api";

import {
	notifyProjectEvent,
	type ProjectEventsEnv,
} from "./notify-project-event";

/** A structural fake of the real `DurableObjectNamespace<ProjectEventsDO>`
 * binding — only `idFromName`/`get` are ever called by `notifyProjectEvent`. */
function fakeEnv(
	broadcast: (event: ProjectEvent) => Promise<void>,
): ProjectEventsEnv {
	return {
		PROJECT_EVENTS: {
			idFromName: (name: string) => name,
			get: () => ({ broadcast }),
		} as unknown as ProjectEventsEnv["PROJECT_EVENTS"],
	};
}

const projectEvent: ProjectEvent = {
	type: "project",
	projectId: "project_1",
	status: "ready",
	at: 1_720_000_000_000,
};

describe("notifyProjectEvent", () => {
	test("forwards the event to the project's DO stub", async () => {
		const calls: ProjectEvent[] = [];
		const env = fakeEnv(async (event) => {
			calls.push(event);
		});

		await notifyProjectEvent(env, projectEvent);

		expect(calls).toEqual([projectEvent]);
	});

	test("swallows a broadcast failure instead of throwing", async () => {
		const env = fakeEnv(async () => {
			throw new Error("stub unreachable");
		});

		await expect(
			notifyProjectEvent(env, projectEvent),
		).resolves.toBeUndefined();
	});
});
