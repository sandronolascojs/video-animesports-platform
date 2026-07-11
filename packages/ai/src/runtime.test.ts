import { describe, expect, test } from "bun:test";

import { createInMemoryCacheStore } from "./cache";
import { createProjectRuntime } from "./runtime";

describe("createProjectRuntime", () => {
	test("runAgent calls run() on a cache miss and returns its result", async () => {
		const runtime = createProjectRuntime({
			projectId: "test-project",
			cache: createInMemoryCacheStore(),
		});
		let calls = 0;
		const result = await runtime.runAgent<{ n: number }, number>(
			{
				name: "double",
				cacheKey: (input) => String(input.n),
				run: async (input) => {
					calls++;
					return input.n * 2;
				},
			},
			{ n: 21 },
		);
		expect(result).toBe(42);
		expect(calls).toBe(1);
	});

	test("runAgent skips run() on a cache hit for the same cache key", async () => {
		const runtime = createProjectRuntime({
			projectId: "test-project",
			cache: createInMemoryCacheStore(),
		});
		let calls = 0;
		const definition = {
			name: "double",
			cacheKey: (input: { n: number }) => String(input.n),
			run: async (input: { n: number }) => {
				calls++;
				return input.n * 2;
			},
		};
		const first = await runtime.runAgent(definition, { n: 5 });
		const second = await runtime.runAgent(definition, { n: 5 });
		expect(first).toBe(10);
		expect(second).toBe(10);
		expect(calls).toBe(1);
	});

	test("a rejected run() is never cached — the next call retries fresh", async () => {
		const runtime = createProjectRuntime({
			projectId: "test-project",
			cache: createInMemoryCacheStore(),
		});
		let calls = 0;
		const definition = {
			name: "flaky",
			cacheKey: () => "same-key",
			run: async () => {
				calls++;
				if (calls === 1) {
					throw new Error("first call fails");
				}
				return "ok";
			},
		};
		await expect(runtime.runAgent(definition, undefined)).rejects.toThrow(
			"first call fails",
		);
		const result = await runtime.runAgent(definition, undefined);
		expect(result).toBe("ok");
		expect(calls).toBe(2);
	});

	test("different agent names never collide even with the same cache key material", async () => {
		const runtime = createProjectRuntime({
			projectId: "test-project",
			cache: createInMemoryCacheStore(),
		});
		const a = await runtime.runAgent(
			{ name: "agent-a", cacheKey: () => "same", run: async () => "a-result" },
			undefined,
		);
		const b = await runtime.runAgent(
			{ name: "agent-b", cacheKey: () => "same", run: async () => "b-result" },
			undefined,
		);
		expect(a).toBe("a-result");
		expect(b).toBe("b-result");
	});

	test("defaults to a fresh in-memory cache when none is provided", async () => {
		const runtime = createProjectRuntime({ projectId: "test-project" });
		const result = await runtime.runAgent(
			{ name: "noop", cacheKey: () => "k", run: async () => "value" },
			undefined,
		);
		expect(result).toBe("value");
	});
});
