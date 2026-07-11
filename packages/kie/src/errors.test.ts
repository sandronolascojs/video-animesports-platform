import { describe, expect, test } from "bun:test";

import { KieError } from "./errors";

describe("KieError.retryable classification matrix", () => {
	test("undefined status (network/DNS/timeout failure) is retryable", () => {
		expect(new KieError("network error").retryable).toBe(true);
	});

	test("429 (rate limited) is retryable", () => {
		expect(new KieError("rate limited", { status: 429 }).retryable).toBe(true);
	});

	test("500 (server error) is retryable", () => {
		expect(new KieError("server error", { status: 500 }).retryable).toBe(true);
	});

	test("503 (server error) is retryable", () => {
		expect(new KieError("unavailable", { status: 503 }).retryable).toBe(true);
	});

	test("400 (validation) is NOT retryable", () => {
		expect(new KieError("bad request", { status: 400 }).retryable).toBe(false);
	});

	test("401 (auth) is NOT retryable", () => {
		expect(new KieError("unauthorized", { status: 401 }).retryable).toBe(false);
	});

	test("402 (insufficient credits) is NOT retryable", () => {
		expect(
			new KieError("insufficient credits", { status: 402 }).retryable,
		).toBe(false);
	});

	test("404 is NOT retryable", () => {
		expect(new KieError("not found", { status: 404 }).retryable).toBe(false);
	});

	test("preserves taskId/code/cause for downstream branching", () => {
		const cause = new Error("root cause");
		const error = new KieError("boom", {
			status: 500,
			code: "500",
			taskId: "task-1",
			cause,
		});
		expect(error.taskId).toBe("task-1");
		expect(error.code).toBe("500");
		expect(error.cause).toBe(cause);
		expect(error.name).toBe("KieError");
	});
});
