// Query-shape tests for agent-message.repository.ts (AI-6a §8a fixes 5, 7),
// run against a FAKE `tx` object mimicking just enough of drizzle's
// chainable query-builder API to capture the arguments the repository
// passes to it — no live DB connection needed (see lib/mark-rendered.ts's
// doc comment for why this app's repositories/services can't import
// @video-platform-challenge/db's root under plain `bun test`; this file only
// imports the `./schema` subpath, which is safe — table definitions, no
// live client).

import { describe, expect, test } from "bun:test";
import { agentMessages } from "@video-platform-challenge/db/schema";
import { and, asc, eq, gte } from "drizzle-orm";

import * as agentMessageRepository from "./agent-message.repository";

type Recorded = {
	from?: unknown[];
	where?: unknown[];
	orderBy?: unknown[];
	limit?: unknown[];
};

type FakeChain = Promise<unknown> & {
	from: (...args: unknown[]) => FakeChain;
	where: (...args: unknown[]) => FakeChain;
	orderBy: (...args: unknown[]) => FakeChain;
	limit: (...args: unknown[]) => FakeChain;
};

/** A minimal chainable stub covering exactly the methods this repository's
 * functions call. Real drizzle query builders are themselves awaitable at
 * ANY point in the chain (`await tx.select().from().where()` resolves
 * without an explicit `.limit()`, exactly like `countUserMessagesSince`
 * does) — mirrored here by building each returned link as a genuine
 * `Promise` (via `Object.assign` onto `Promise.resolve(finalResult)`, not a
 * custom `then` property) with the chain methods attached, so `await` at any
 * point resolves via the real `Promise.prototype.then`. */
function fakeTx(finalResult: unknown) {
	const recorded: Recorded = {};
	const chain: FakeChain = Object.assign(Promise.resolve(finalResult), {
		from: (...args: unknown[]) => {
			recorded.from = args;
			return chain;
		},
		limit: (...args: unknown[]) => {
			recorded.limit = args;
			return chain;
		},
		orderBy: (...args: unknown[]) => {
			recorded.orderBy = args;
			return chain;
		},
		where: (...args: unknown[]) => {
			recorded.where = args;
			return chain;
		},
	});
	const tx = {
		insert: () => {
			throw new Error("insert should not be called by this test");
		},
		select: () => chain,
		// biome-ignore lint/suspicious/noExplicitAny: fake tx only implements the subset of UserScopedTx these repository functions actually call.
	} as any;
	return { recorded, tx };
}

describe("findByProjectId", () => {
	test("orders by (createdAt asc, id asc) — the secondary key breaks same-timestamp ties deterministically", async () => {
		const { recorded, tx } = fakeTx([]);
		await agentMessageRepository.findByProjectId(tx, "user-1", "project-1");
		expect(recorded.orderBy).toEqual([
			asc(agentMessages.createdAt),
			asc(agentMessages.id),
		]);
	});

	test("filters by projectId AND userId (ownership-scoped)", async () => {
		const { recorded, tx } = fakeTx([]);
		await agentMessageRepository.findByProjectId(tx, "user-1", "project-1");
		expect(recorded.where).toEqual([
			and(
				eq(agentMessages.projectId, "project-1"),
				eq(agentMessages.userId, "user-1"),
			),
		]);
	});
});

describe("countUserMessagesSince", () => {
	test("filters by projectId, userId, role=user, and createdAt >= since", async () => {
		const since = new Date("2026-07-11T00:00:00Z");
		const { recorded, tx } = fakeTx([{ value: 3 }]);
		const count = await agentMessageRepository.countUserMessagesSince(
			tx,
			"user-1",
			"project-1",
			since,
		);
		expect(count).toBe(3);
		expect(recorded.where).toEqual([
			and(
				eq(agentMessages.projectId, "project-1"),
				eq(agentMessages.userId, "user-1"),
				eq(agentMessages.role, "user"),
				gte(agentMessages.createdAt, since),
			),
		]);
	});

	test("returns 0 when the count query yields no row", async () => {
		const { tx } = fakeTx([]);
		const count = await agentMessageRepository.countUserMessagesSince(
			tx,
			"user-1",
			"project-1",
			new Date(),
		);
		expect(count).toBe(0);
	});
});

describe("insertMany", () => {
	test("short-circuits to [] without touching the tx for an empty values array", async () => {
		const { tx } = fakeTx([]);
		const result = await agentMessageRepository.insertMany(tx, []);
		expect(result).toEqual([]);
	});
});
