import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import {
	type AgentTurnTxOps,
	DEFAULT_MAX_CONTEXT_MESSAGES,
	hasMeaningfulAssistantContent,
	type PersistedAgentMessage,
	planAgentTurn,
	runAgentTurnTx,
} from "./agent-chat-turn";

function userMessage(id: string, text = "hi"): UIMessage {
	return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(id: string, text = "ok"): UIMessage {
	return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function persistedRow(
	id: string,
	role: PersistedAgentMessage["role"],
	createdAt: Date,
): PersistedAgentMessage {
	return { createdAt, id, parts: [{ text: "x", type: "text" }], role };
}

describe("hasMeaningfulAssistantContent", () => {
	test("false for an empty parts array (the stream-error case)", () => {
		expect(hasMeaningfulAssistantContent([])).toBe(false);
	});

	test("false for a whitespace-only text part", () => {
		expect(hasMeaningfulAssistantContent([{ text: "   ", type: "text" }])).toBe(
			false,
		);
	});

	test("true for a non-empty text part", () => {
		expect(
			hasMeaningfulAssistantContent([{ text: "Done!", type: "text" }]),
		).toBe(true);
	});

	test("true for a tool part even with no text alongside it", () => {
		expect(
			hasMeaningfulAssistantContent([
				{
					input: {},
					output: { started: true },
					state: "output-available",
					toolCallId: "call-1",
					type: "tool-render_version",
				},
			]),
		).toBe(true);
	});
});

describe("planAgentTurn", () => {
	test("ownership miss short-circuits to not_found before any persist/rate-limit decision", () => {
		const plan = planAgentTurn({
			incomingMessages: [userMessage("m1")],
			persistedHistory: [],
			projectExists: false,
			recentUserMessageCount: 0,
		});
		expect(plan).toEqual({ type: "not_found" });
	});

	test("rate limit trips when a NEW user message arrives at/over the cap", () => {
		const plan = planAgentTurn({
			incomingMessages: [userMessage("new-msg")],
			maxTurnsPerHour: 5,
			persistedHistory: [],
			projectExists: true,
			recentUserMessageCount: 5,
		});
		expect(plan).toEqual({ type: "rate_limited" });
	});

	test("rate limit does NOT trip below the cap", () => {
		const plan = planAgentTurn({
			incomingMessages: [userMessage("new-msg")],
			maxTurnsPerHour: 5,
			persistedHistory: [],
			projectExists: true,
			recentUserMessageCount: 4,
		});
		expect(plan.type).toBe("ok");
	});

	test("rate limit does NOT trip when there's no new user message (a resync/no-op turn)", () => {
		const persisted = [persistedRow("m1", "user", new Date("2026-01-01"))];
		const plan = planAgentTurn({
			incomingMessages: [userMessage("m1")],
			maxTurnsPerHour: 1,
			persistedHistory: persisted,
			projectExists: true,
			recentUserMessageCount: 100,
		});
		expect(plan.type).toBe("ok");
	});

	test("merges persisted history with unknown client messages, persisted wins on id conflict", () => {
		const persisted = [
			persistedRow("m1", "user", new Date("2026-01-01T00:00:00Z")),
			persistedRow("m2", "assistant", new Date("2026-01-01T00:00:05Z")),
		];
		// The client's copy of m1 carries different (stale) parts — persisted
		// must win. m3 is a genuinely new, not-yet-persisted user message.
		const incoming: UIMessage[] = [
			{
				id: "m1",
				parts: [{ text: "stale local copy", type: "text" }],
				role: "user",
			},
			assistantMessage("m2", "stale local copy too"),
			userMessage("m3", "brand new"),
		];

		const plan = planAgentTurn({
			incomingMessages: incoming,
			persistedHistory: persisted,
			projectExists: true,
			recentUserMessageCount: 0,
		});

		expect(plan.type).toBe("ok");
		if (plan.type !== "ok") {
			return;
		}
		expect(plan.modelMessages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
		// Persisted row's parts win, not the client's stale local copy — compare
		// serialized content rather than the raw arrays: `PersistedAgentMessage.
		// parts` is deliberately `unknown[]` (mirrors the DB's loose jsonb
		// column) while `UIMessage["parts"]` is a strict AI SDK union, so a
		// direct `toEqual` needs a cast on one side for no real safety gain —
		// `JSON.stringify` sidesteps that without any `as`.
		const m1 = plan.modelMessages.find((m) => m.id === "m1");
		expect(JSON.stringify(m1?.parts)).toBe(JSON.stringify(persisted[0]?.parts));
		expect(plan.userMessageToPersist?.id).toBe("m3");
	});

	test("a message id already in persisted history is never re-persisted, even as the last message", () => {
		const persisted = [persistedRow("m1", "user", new Date("2026-01-01"))];
		const plan = planAgentTurn({
			incomingMessages: [userMessage("m1")],
			persistedHistory: persisted,
			projectExists: true,
			recentUserMessageCount: 0,
		});
		expect(plan.type).toBe("ok");
		if (plan.type === "ok") {
			expect(plan.userMessageToPersist).toBeNull();
		}
	});

	test("caps the merged list to the last N messages", () => {
		const persisted = Array.from({ length: 40 }, (_, i) =>
			persistedRow(
				`m${i}`,
				i % 2 === 0 ? "user" : "assistant",
				new Date(2026, 0, 1, 0, i),
			),
		);
		const plan = planAgentTurn({
			incomingMessages: [userMessage("m39", "resync")],
			maxContextMessages: 30,
			persistedHistory: persisted,
			projectExists: true,
			recentUserMessageCount: 0,
		});
		expect(plan.type).toBe("ok");
		if (plan.type === "ok") {
			expect(plan.modelMessages).toHaveLength(30);
			expect(plan.modelMessages.at(-1)?.id).toBe("m39");
			expect(plan.modelMessages.at(0)?.id).toBe("m10");
		}
	});

	test("default context cap matches the exported constant", () => {
		expect(DEFAULT_MAX_CONTEXT_MESSAGES).toBe(30);
	});

	test("persisted history already AT the cap plus a genuinely NEW user message: the new message survives the slice as the last entry, oldest persisted entries drop off the front", () => {
		const persisted = Array.from({ length: 30 }, (_, i) =>
			persistedRow(
				`m${i}`,
				i % 2 === 0 ? "user" : "assistant",
				new Date(2026, 0, 1, 0, i),
			),
		);
		const plan = planAgentTurn({
			incomingMessages: [userMessage("m30", "brand new")],
			maxContextMessages: 30,
			persistedHistory: persisted,
			projectExists: true,
			recentUserMessageCount: 0,
		});
		expect(plan.type).toBe("ok");
		if (plan.type !== "ok") {
			return;
		}
		expect(plan.modelMessages).toHaveLength(30);
		expect(plan.modelMessages.at(-1)?.id).toBe("m30");
		expect(plan.modelMessages.at(0)?.id).toBe("m1");
		expect(plan.modelMessages.map((m) => m.id)).not.toContain("m0");
		expect(plan.userMessageToPersist?.id).toBe("m30");
	});
});

describe("runAgentTurnTx", () => {
	type FakeProject = { id: string };
	type FakeScene = { id: string };

	function orderedOps(
		overrides: Partial<AgentTurnTxOps<FakeProject, FakeScene>> = {},
	): { order: string[]; ops: AgentTurnTxOps<FakeProject, FakeScene> } {
		const order: string[] = [];
		const ops: AgentTurnTxOps<FakeProject, FakeScene> = {
			countRecentUserMessages: async () => {
				order.push("countRecentUserMessages");
				return 0;
			},
			findHistory: async () => {
				order.push("findHistory");
				return [];
			},
			findScenes: async () => {
				order.push("findScenes");
				return [];
			},
			insertUserMessage: async () => {
				order.push("insertUserMessage");
			},
			lockProject: async () => {
				order.push("lockProject");
				return { id: "project-1" };
			},
			...overrides,
		};
		return { order, ops };
	}

	test("ordering contract: lock runs first, count runs before insert, for a genuinely new user message", async () => {
		const { order, ops } = orderedOps();
		const result = await runAgentTurnTx(ops, {
			incomingMessages: [userMessage("m1")],
		});
		expect(result.type).toBe("ok");
		expect(order).toEqual([
			"lockProject",
			"findScenes",
			"findHistory",
			"countRecentUserMessages",
			"insertUserMessage",
		]);
		expect(order.indexOf("lockProject")).toBeLessThan(
			order.indexOf("countRecentUserMessages"),
		);
		expect(order.indexOf("countRecentUserMessages")).toBeLessThan(
			order.indexOf("insertUserMessage"),
		);
	});

	test("a rate-limited turn (count at the cap) never calls insertUserMessage", async () => {
		const { order, ops } = orderedOps({
			countRecentUserMessages: async () => {
				order.push("countRecentUserMessages");
				return 30; // at the default MAX_AGENT_TURNS_PER_HOUR
			},
		});
		const result = await runAgentTurnTx(ops, {
			incomingMessages: [userMessage("m1")],
		});
		expect(result.type).toBe("rate_limited");
		expect(order).not.toContain("insertUserMessage");
	});

	test("a not_found lock short-circuits before any read/count/insert op runs", async () => {
		const { order, ops } = orderedOps({
			lockProject: async () => {
				order.push("lockProject");
				return null;
			},
		});
		const result = await runAgentTurnTx(ops, {
			incomingMessages: [userMessage("m1")],
		});
		expect(result.type).toBe("not_found");
		expect(order).toEqual(["lockProject"]);
	});

	test("a resync turn (latest message already persisted) never calls insertUserMessage", async () => {
		const persisted = [persistedRow("m1", "user", new Date("2026-01-01"))];
		const { order, ops } = orderedOps({
			findHistory: async () => {
				order.push("findHistory");
				return persisted;
			},
		});
		const result = await runAgentTurnTx(ops, {
			incomingMessages: [userMessage("m1")],
		});
		expect(result.type).toBe("ok");
		expect(order).not.toContain("insertUserMessage");
	});

	test("on success, returns the locked project/scenes and the ok plan straight through", async () => {
		const project: FakeProject = { id: "project-42" };
		const scenes: FakeScene[] = [{ id: "scene-1" }];
		const { ops } = orderedOps({
			findScenes: async () => scenes,
			lockProject: async () => project,
		});
		const result = await runAgentTurnTx(ops, {
			incomingMessages: [userMessage("m1")],
		});
		expect(result.type).toBe("ok");
		if (result.type !== "ok") {
			return;
		}
		expect(result.project).toBe(project);
		expect(result.scenes).toBe(scenes);
		expect(result.plan.userMessageToPersist?.id).toBe("m1");
	});
});
