import { describe, expect, test } from "bun:test";

import {
	buildKieCallbackUrl,
	isAllowedResultUrl,
	KIE_WEBHOOK_PATH,
	parseKieWebhookPayload,
	verifyWebhookSignature,
} from "./webhook";

const SECRET = "test-webhook-secret";

async function sign(
	taskId: string,
	timestamp: string,
	secret = SECRET,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${taskId}.${timestamp}`),
	);
	let binary = "";
	for (const byte of new Uint8Array(digest)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

describe("verifyWebhookSignature", () => {
	test("accepts a validly-signed, fresh payload", async () => {
		const taskId = "task-123";
		const now = Date.now();
		const timestamp = String(Math.floor(now / 1000));
		const signature = await sign(taskId, timestamp);

		const valid = await verifyWebhookSignature({
			taskId,
			timestamp,
			signature,
			secret: SECRET,
			now,
		});
		expect(valid).toBe(true);
	});

	test("rejects a tampered signature", async () => {
		const taskId = "task-123";
		const now = Date.now();
		const timestamp = String(Math.floor(now / 1000));
		const signature = await sign(taskId, timestamp);
		const tampered = `${signature.slice(0, -2)}xx`;

		const valid = await verifyWebhookSignature({
			taskId,
			timestamp,
			signature: tampered,
			secret: SECRET,
			now,
		});
		expect(valid).toBe(false);
	});

	test("rejects a signature computed with the wrong secret", async () => {
		const taskId = "task-123";
		const now = Date.now();
		const timestamp = String(Math.floor(now / 1000));
		const signature = await sign(taskId, timestamp, "wrong-secret");

		const valid = await verifyWebhookSignature({
			taskId,
			timestamp,
			signature,
			secret: SECRET,
			now,
		});
		expect(valid).toBe(false);
	});

	test("rejects a stale timestamp (outside the ±5 minute window)", async () => {
		const taskId = "task-123";
		const now = Date.now();
		// 10 minutes old.
		const staleTimestamp = String(Math.floor(now / 1000) - 10 * 60);
		const signature = await sign(taskId, staleTimestamp);

		const valid = await verifyWebhookSignature({
			taskId,
			timestamp: staleTimestamp,
			signature,
			secret: SECRET,
			now,
		});
		expect(valid).toBe(false);
	});

	test("rejects a non-numeric timestamp", async () => {
		const valid = await verifyWebhookSignature({
			taskId: "task-123",
			timestamp: "not-a-number",
			signature: "irrelevant",
			secret: SECRET,
		});
		expect(valid).toBe(false);
	});

	test("accepts a signature right at the edge of the tolerance window", async () => {
		const taskId = "task-123";
		const now = Date.now();
		const edgeTimestamp = String(Math.floor(now / 1000) - 5 * 60 + 1);
		const signature = await sign(taskId, edgeTimestamp);

		const valid = await verifyWebhookSignature({
			taskId,
			timestamp: edgeTimestamp,
			signature,
			secret: SECRET,
			now,
		});
		expect(valid).toBe(true);
	});
});

describe("parseKieWebhookPayload", () => {
	test("parses a camelCase taskId payload", () => {
		const { taskId } = parseKieWebhookPayload(
			JSON.stringify({ code: 200, data: { taskId: "abc" } }),
		);
		expect(taskId).toBe("abc");
	});

	test("parses a snake_case task_id payload (kie's own doc-sample fallback)", () => {
		const { taskId } = parseKieWebhookPayload(
			JSON.stringify({ code: 200, data: { task_id: "abc" } }),
		);
		expect(taskId).toBe("abc");
	});

	test("throws on malformed JSON", () => {
		expect(() => parseKieWebhookPayload("{not json")).toThrow();
	});

	test("throws when data.taskId/task_id is missing", () => {
		expect(() =>
			parseKieWebhookPayload(JSON.stringify({ code: 200, data: {} })),
		).toThrow();
	});

	test("throws when the body isn't the expected shape at all", () => {
		expect(() =>
			parseKieWebhookPayload(JSON.stringify("just a string")),
		).toThrow();
	});
});

describe("buildKieCallbackUrl / KIE_WEBHOOK_PATH", () => {
	test("joins the server base URL and the webhook path without double slashes", () => {
		expect(buildKieCallbackUrl("https://api.example.com/")).toBe(
			`https://api.example.com${KIE_WEBHOOK_PATH}`,
		);
		expect(buildKieCallbackUrl("https://api.example.com")).toBe(
			`https://api.example.com${KIE_WEBHOOK_PATH}`,
		);
	});
});

describe("isAllowedResultUrl", () => {
	test("allows an https URL on the allowlisted kie.ai domain", () => {
		expect(isAllowedResultUrl("https://kie.ai/files/abc.png")).toBe(true);
	});

	test("allows a subdomain of an allowlisted domain", () => {
		expect(isAllowedResultUrl("https://tempfile.kie.ai/abc.mp4")).toBe(true);
	});

	test("rejects http (non-https)", () => {
		expect(isAllowedResultUrl("http://kie.ai/files/abc.png")).toBe(false);
	});

	test("rejects a non-allowlisted host", () => {
		expect(isAllowedResultUrl("https://evil.example.com/abc.png")).toBe(false);
	});

	test("rejects a host that merely contains the allowlisted domain as a substring", () => {
		expect(isAllowedResultUrl("https://kie.ai.evil.com/abc.png")).toBe(false);
	});

	test("rejects a malformed URL without throwing", () => {
		expect(isAllowedResultUrl("not a url")).toBe(false);
	});
});
