import { describe, expect, test } from "bun:test";

import {
	agentChatRequestBodySchema,
	MAX_AGENT_CHAT_BODY_BYTES,
} from "./agent-chat-request";

function validMessage(id = "m1", role: "user" | "assistant" = "user") {
	return { id, parts: [{ text: "hi", type: "text" }], role };
}

describe("agentChatRequestBodySchema", () => {
	test("accepts a well-shaped body with one user message", () => {
		const result = agentChatRequestBodySchema.safeParse({
			messages: [validMessage()],
		});
		expect(result.success).toBe(true);
	});

	test("accepts extra UIMessage fields via passthrough (not a full re-model)", () => {
		const result = agentChatRequestBodySchema.safeParse({
			id: "chat-1",
			messages: [{ ...validMessage(), metadata: { foo: "bar" } }],
			trigger: "submit-message",
		});
		expect(result.success).toBe(true);
	});

	test("rejects a missing messages field", () => {
		const result = agentChatRequestBodySchema.safeParse({});
		expect(result.success).toBe(false);
	});

	test("rejects an empty messages array", () => {
		const result = agentChatRequestBodySchema.safeParse({ messages: [] });
		expect(result.success).toBe(false);
	});

	test("rejects more than 50 messages", () => {
		const messages = Array.from({ length: 51 }, (_, i) =>
			validMessage(`m${i}`),
		);
		const result = agentChatRequestBodySchema.safeParse({ messages });
		expect(result.success).toBe(false);
	});

	test("accepts exactly 50 messages", () => {
		const messages = Array.from({ length: 50 }, (_, i) =>
			validMessage(`m${i}`),
		);
		const result = agentChatRequestBodySchema.safeParse({ messages });
		expect(result.success).toBe(true);
	});

	test("rejects a message missing an id", () => {
		const result = agentChatRequestBodySchema.safeParse({
			messages: [{ parts: [], role: "user" }],
		});
		expect(result.success).toBe(false);
	});

	test('rejects a message with role "system" (only user/assistant accepted at this boundary)', () => {
		const result = agentChatRequestBodySchema.safeParse({
			messages: [validMessage("m1", "system" as "user")],
		});
		expect(result.success).toBe(false);
	});

	test("rejects a message whose parts is not an array", () => {
		const result = agentChatRequestBodySchema.safeParse({
			messages: [{ id: "m1", parts: "not-an-array", role: "user" }],
		});
		expect(result.success).toBe(false);
	});

	test("rejects a non-object body", () => {
		const result = agentChatRequestBodySchema.safeParse("not an object");
		expect(result.success).toBe(false);
	});
});

describe("MAX_AGENT_CHAT_BODY_BYTES", () => {
	test("is a generous but finite bound", () => {
		expect(MAX_AGENT_CHAT_BODY_BYTES).toBe(128 * 1024);
	});
});
