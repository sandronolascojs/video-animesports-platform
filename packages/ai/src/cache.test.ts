import { describe, expect, test } from "bun:test";

import {
	buildGenerationCacheKey,
	createInMemoryCacheStore,
	hashString,
} from "./cache";

describe("createInMemoryCacheStore", () => {
	test("returns undefined for a missing key", async () => {
		const store = createInMemoryCacheStore();
		expect(await store.get("missing")).toBeUndefined();
		expect(await store.has("missing")).toBe(false);
	});

	test("stores and retrieves a value", async () => {
		const store = createInMemoryCacheStore();
		await store.set("key", { value: 42 });
		expect(await store.get<{ value: number }>("key")).toEqual({ value: 42 });
		expect(await store.has("key")).toBe(true);
	});

	test("honors a TTL — expired entries read back as missing", async () => {
		const store = createInMemoryCacheStore();
		await store.set("key", "value", -1); // already expired
		expect(await store.get<string>("key")).toBeUndefined();
		expect(await store.has("key")).toBe(false);
	});

	test("a value with no TTL never expires", async () => {
		const store = createInMemoryCacheStore();
		await store.set("key", "value");
		expect(await store.get<string>("key")).toBe("value");
	});
});

describe("hashString", () => {
	test("is deterministic — same input hashes to the same output", () => {
		expect(hashString("hello world")).toBe(hashString("hello world"));
	});

	test("different inputs hash to different outputs", () => {
		expect(hashString("a")).not.toBe(hashString("b"));
	});

	test("hashes the empty string without throwing", () => {
		expect(typeof hashString("")).toBe("string");
	});
});

describe("buildGenerationCacheKey", () => {
	test("is deterministic for identical parts", () => {
		const parts = {
			modelId: "anthropic/claude-sonnet-4.5",
			system: "system prompt",
			prompt: "user prompt",
			schemaShape: "3",
		};
		expect(buildGenerationCacheKey(parts)).toBe(buildGenerationCacheKey(parts));
	});

	test("differs when any single part changes", () => {
		const base = {
			modelId: "anthropic/claude-sonnet-4.5",
			system: "system prompt",
			prompt: "user prompt",
			schemaShape: "3",
		};
		const key = buildGenerationCacheKey(base);
		expect(buildGenerationCacheKey({ ...base, modelId: "other" })).not.toBe(
			key,
		);
		expect(buildGenerationCacheKey({ ...base, system: "other" })).not.toBe(key);
		expect(buildGenerationCacheKey({ ...base, prompt: "other" })).not.toBe(key);
		expect(buildGenerationCacheKey({ ...base, schemaShape: "4" })).not.toBe(
			key,
		);
	});
});
