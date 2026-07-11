import { describe, expect, test } from "bun:test";

import { handleKieWebhook } from "./generation-webhook.service";

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

function unreachable(): never {
	throw new Error("should not be called on this branch");
}

const NEVER_LOOKUP = () => Promise.resolve(unreachable() as never);
const NEVER_INSTANCE = () => Promise.resolve(unreachable() as never);

async function validEnvelope(taskId = "task-123") {
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = await sign(taskId, timestamp);
	return { taskId, timestamp, signature };
}

describe("handleKieWebhook", () => {
	test("401s when the timestamp header is missing", async () => {
		const result = await handleKieWebhook({
			timestamp: undefined,
			signature: "sig",
			contentLength: undefined,
			readBody: () => Promise.resolve(""),
			webhookSecret: SECRET,
			findTaskByKieTaskId: NEVER_LOOKUP,
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 401, message: "Unauthorized" });
	});

	test("401s when the signature header is missing", async () => {
		const result = await handleKieWebhook({
			timestamp: "123",
			signature: undefined,
			contentLength: undefined,
			readBody: () => Promise.resolve(""),
			webhookSecret: SECRET,
			findTaskByKieTaskId: NEVER_LOOKUP,
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 401, message: "Unauthorized" });
	});

	test("413s on an oversized declared Content-Length, before reading the body", async () => {
		let bodyRead = false;
		const result = await handleKieWebhook({
			timestamp: "123",
			signature: "sig",
			contentLength: 64 * 1024 + 1,
			readBody: () => {
				bodyRead = true;
				return Promise.resolve("");
			},
			webhookSecret: SECRET,
			findTaskByKieTaskId: NEVER_LOOKUP,
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 413, message: "Payload Too Large" });
		expect(bodyRead).toBe(false);
	});

	test("413s on an oversized actual body when Content-Length was absent/spoofed", async () => {
		const oversized = "x".repeat(64 * 1024 + 1);
		const result = await handleKieWebhook({
			timestamp: "123",
			signature: "sig",
			contentLength: undefined,
			readBody: () => Promise.resolve(oversized),
			webhookSecret: SECRET,
			findTaskByKieTaskId: NEVER_LOOKUP,
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 413, message: "Payload Too Large" });
	});

	test("400s on a malformed body", async () => {
		const result = await handleKieWebhook({
			timestamp: "123",
			signature: "sig",
			contentLength: undefined,
			readBody: () => Promise.resolve("{not json"),
			webhookSecret: SECRET,
			findTaskByKieTaskId: NEVER_LOOKUP,
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 400, message: "Bad Request" });
	});

	test("401s on a tampered signature", async () => {
		const { taskId, timestamp, signature } = await validEnvelope();
		const result = await handleKieWebhook({
			timestamp,
			signature: `${signature.slice(0, -2)}xx`,
			contentLength: undefined,
			readBody: () =>
				Promise.resolve(JSON.stringify({ code: 200, data: { taskId } })),
			webhookSecret: SECRET,
			findTaskByKieTaskId: NEVER_LOOKUP,
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 401, message: "Unauthorized" });
	});

	test("200s (idempotent) when the taskId is unknown", async () => {
		const { taskId, timestamp, signature } = await validEnvelope();
		const result = await handleKieWebhook({
			timestamp,
			signature,
			contentLength: undefined,
			readBody: () =>
				Promise.resolve(JSON.stringify({ code: 200, data: { taskId } })),
			webhookSecret: SECRET,
			findTaskByKieTaskId: () => Promise.resolve(null),
			getWorkflowInstance: NEVER_INSTANCE,
		});
		expect(result).toEqual({ status: 200, message: "OK" });
	});

	test("200s without sendEvent when the task already resolved (duplicate delivery)", async () => {
		const { taskId, timestamp, signature } = await validEnvelope();
		let instanceFetched = false;
		const result = await handleKieWebhook({
			timestamp,
			signature,
			contentLength: undefined,
			readBody: () =>
				Promise.resolve(JSON.stringify({ code: 200, data: { taskId } })),
			webhookSecret: SECRET,
			findTaskByKieTaskId: () =>
				Promise.resolve({
					kieTaskId: taskId,
					workflowInstanceId: "wf-1",
					status: "success",
				}),
			getWorkflowInstance: () => {
				instanceFetched = true;
				return Promise.resolve({ sendEvent: () => Promise.resolve() });
			},
		});
		expect(result).toEqual({ status: 200, message: "OK" });
		expect(instanceFetched).toBe(false);
	});

	test("resolves the workflow instance and sendEvents it for a pending task", async () => {
		const { taskId, timestamp, signature } = await validEnvelope();
		let sentEvent: { type: string; payload: unknown } | undefined;
		const result = await handleKieWebhook({
			timestamp,
			signature,
			contentLength: undefined,
			readBody: () =>
				Promise.resolve(
					JSON.stringify({ code: 200, data: { task_id: taskId } }),
				),
			webhookSecret: SECRET,
			findTaskByKieTaskId: () =>
				Promise.resolve({
					kieTaskId: taskId,
					workflowInstanceId: "wf-1",
					status: "pending",
				}),
			getWorkflowInstance: (instanceId) => {
				expect(instanceId).toBe("wf-1");
				return Promise.resolve({
					sendEvent: (event) => {
						sentEvent = event;
						return Promise.resolve();
					},
				});
			},
		});
		expect(result).toEqual({ status: 200, message: "OK" });
		expect(sentEvent).toEqual({
			type: `kie-task:${taskId}`,
			payload: { taskId },
		});
	});

	test("still 200s when sendEvent itself throws (instance may have moved on via poll fallback)", async () => {
		const { taskId, timestamp, signature } = await validEnvelope();
		const result = await handleKieWebhook({
			timestamp,
			signature,
			contentLength: undefined,
			readBody: () =>
				Promise.resolve(JSON.stringify({ code: 200, data: { taskId } })),
			webhookSecret: SECRET,
			findTaskByKieTaskId: () =>
				Promise.resolve({
					kieTaskId: taskId,
					workflowInstanceId: "wf-1",
					status: "pending",
				}),
			getWorkflowInstance: () =>
				Promise.resolve({
					sendEvent: () => Promise.reject(new Error("instance gone")),
				}),
		});
		expect(result).toEqual({ status: 200, message: "OK" });
	});
});
