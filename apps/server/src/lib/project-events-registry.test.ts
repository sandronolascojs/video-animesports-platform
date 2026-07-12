import { describe, expect, test } from "bun:test";
import type { ProjectEvent } from "@video-platform-challenge/api";

import {
	createProjectEventRegistry,
	type EventSubscriber,
	formatEventFrame,
	formatHeartbeatFrame,
	MAX_SUBSCRIBERS_PER_PROJECT,
} from "./project-events-registry";

const decoder = new TextDecoder();

function fakeSubscriber(overrides?: Partial<EventSubscriber>): {
	subscriber: EventSubscriber;
	received: Uint8Array[];
} {
	const received: Uint8Array[] = [];
	const subscriber: EventSubscriber = {
		write: async (chunk) => {
			received.push(chunk);
		},
		...overrides,
	};
	return { subscriber, received };
}

const sceneEvent: ProjectEvent = {
	type: "scene",
	projectId: "project_1",
	sceneId: "scene_1",
	status: "video_ready",
	at: 1_720_000_000_000,
};

describe("formatEventFrame", () => {
	test("formats as an SSE data frame", () => {
		const frame = formatEventFrame(sceneEvent);
		expect(decoder.decode(frame)).toBe(
			`data: ${JSON.stringify(sceneEvent)}\n\n`,
		);
	});
});

describe("formatHeartbeatFrame", () => {
	test("formats as an SSE comment", () => {
		expect(decoder.decode(formatHeartbeatFrame())).toBe(": ping\n\n");
	});
});

describe("createProjectEventRegistry", () => {
	test("starts empty", () => {
		const registry = createProjectEventRegistry();
		expect(registry.size()).toBe(0);
	});

	test("add() registers a subscriber and increments size", () => {
		const registry = createProjectEventRegistry();
		const { subscriber } = fakeSubscriber();
		expect(registry.add(subscriber)).toBe(true);
		expect(registry.size()).toBe(1);
	});

	test("add() rejects beyond MAX_SUBSCRIBERS_PER_PROJECT", () => {
		const registry = createProjectEventRegistry();
		for (let i = 0; i < MAX_SUBSCRIBERS_PER_PROJECT; i++) {
			expect(registry.add(fakeSubscriber().subscriber)).toBe(true);
		}
		expect(registry.size()).toBe(MAX_SUBSCRIBERS_PER_PROJECT);

		const { subscriber: overflow } = fakeSubscriber();
		expect(registry.add(overflow)).toBe(false);
		expect(registry.size()).toBe(MAX_SUBSCRIBERS_PER_PROJECT);
	});

	test("remove() deregisters a subscriber", () => {
		const registry = createProjectEventRegistry();
		const { subscriber } = fakeSubscriber();
		registry.add(subscriber);
		registry.remove(subscriber);
		expect(registry.size()).toBe(0);
	});

	test("remove() on an unregistered subscriber is a no-op", () => {
		const registry = createProjectEventRegistry();
		expect(() => registry.remove(fakeSubscriber().subscriber)).not.toThrow();
	});

	test("broadcast() is a no-op with no subscribers", async () => {
		const registry = createProjectEventRegistry();
		await expect(registry.broadcast(sceneEvent)).resolves.toBeUndefined();
	});

	test("broadcast() writes the formatted frame to every subscriber", async () => {
		const registry = createProjectEventRegistry();
		const a = fakeSubscriber();
		const b = fakeSubscriber();
		registry.add(a.subscriber);
		registry.add(b.subscriber);

		await registry.broadcast(sceneEvent);

		const expected = formatEventFrame(sceneEvent);
		expect(a.received).toEqual([expected]);
		expect(b.received).toEqual([expected]);
	});

	test("broadcast() evicts a subscriber whose write throws", async () => {
		const registry = createProjectEventRegistry();
		const good = fakeSubscriber();
		const bad = fakeSubscriber({
			write: async () => {
				throw new Error("connection closed");
			},
		});
		registry.add(good.subscriber);
		registry.add(bad.subscriber);
		expect(registry.size()).toBe(2);

		await registry.broadcast(sceneEvent);

		expect(registry.size()).toBe(1);
		expect(good.received).toEqual([formatEventFrame(sceneEvent)]);

		// The evicted subscriber no longer receives further broadcasts.
		await registry.broadcast(sceneEvent);
		expect(good.received.length).toBe(2);
	});

	test("heartbeat() writes the ping frame to every subscriber", async () => {
		const registry = createProjectEventRegistry();
		const { subscriber, received } = fakeSubscriber();
		registry.add(subscriber);

		await registry.heartbeat();

		expect(received).toEqual([formatHeartbeatFrame()]);
	});

	test("a real WritableStreamDefaultWriter satisfies EventSubscriber structurally", () => {
		// Compile-time/structural check only (not exercised end-to-end here —
		// piping a TransformStream through a real reader is exactly what
		// durable/project-events.ts does, and that file needs a live worker to
		// verify, per this file's own doc comment): confirms the interface this
		// registry is built around is the SAME shape Cloudflare's runtime hands
		// it in production, not a fake-only contract.
		const { writable } = new TransformStream<Uint8Array, Uint8Array>();
		const writer = writable.getWriter();
		const subscriber: EventSubscriber = writer;
		expect(typeof subscriber.write).toBe("function");
		writer.abort().catch(() => {});
	});
});
