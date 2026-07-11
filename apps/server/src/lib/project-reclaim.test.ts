import { describe, expect, test } from "bun:test";

import { isProjectReclaimable } from "./project-reclaim";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const TERMINAL = ["ready", "failed"] as const;

describe("isProjectReclaimable", () => {
	test("a terminal status is always reclaimable regardless of age", () => {
		expect(
			isProjectReclaimable({
				status: "ready",
				terminalStatuses: TERMINAL,
				updatedAt: NOW,
				now: NOW,
				abandonMinutes: 30,
			}),
		).toBe(true);
	});

	test("a non-terminal status younger than the abandon window is NOT reclaimable", () => {
		expect(
			isProjectReclaimable({
				status: "generating",
				terminalStatuses: TERMINAL,
				updatedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
				now: NOW,
				abandonMinutes: 30,
			}),
		).toBe(false);
	});

	test("a non-terminal status past the abandon window IS reclaimable", () => {
		expect(
			isProjectReclaimable({
				status: "generating",
				terminalStatuses: TERMINAL,
				updatedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
				now: NOW,
				abandonMinutes: 30,
			}),
		).toBe(true);
	});

	test("exactly at the abandon window boundary is reclaimable (inclusive)", () => {
		expect(
			isProjectReclaimable({
				status: "generating",
				terminalStatuses: TERMINAL,
				updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
				now: NOW,
				abandonMinutes: 30,
			}),
		).toBe(true);
	});

	test("a status outside the terminal set (e.g. planning) uses the same age check", () => {
		expect(
			isProjectReclaimable({
				status: "planning",
				terminalStatuses: TERMINAL,
				updatedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
				now: NOW,
				abandonMinutes: 30,
			}),
		).toBe(true);
	});
});
