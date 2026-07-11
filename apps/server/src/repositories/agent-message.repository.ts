import type { UserScopedTx } from "@video-platform-challenge/db";
import { agentMessages } from "@video-platform-challenge/db/schema";
import { and, asc, count, eq, gte } from "drizzle-orm";

export type AgentMessageRow = typeof agentMessages.$inferSelect;
export type NewAgentMessageRow = typeof agentMessages.$inferInsert;

// The Studio chat sidebar never needs an unbounded per-project log in one
// response — 200 turns is generous headroom for a single session (docs
// ai-architecture-v1.md §7 "agent_messages retention: unbounded per project
// for now; cap later" — this is the read-side bound, not a retention policy).
const DEFAULT_HISTORY_LIMIT = 200;

export async function insertMany(
	tx: UserScopedTx,
	values: NewAgentMessageRow[],
): Promise<AgentMessageRow[]> {
	if (values.length === 0) {
		return [];
	}
	return tx.insert(agentMessages).values(values).returning();
}

/**
 * AI-6a §8a fix 7: `createdAt` alone isn't a unique ordering key (two rows in
 * the same insert batch can share a timestamp) — `id` (cuid2, generation-
 * ordered) breaks ties deterministically so history replay is always in the
 * same order the turns actually happened.
 */
export async function findByProjectId(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
	limit = DEFAULT_HISTORY_LIMIT,
): Promise<AgentMessageRow[]> {
	return tx
		.select()
		.from(agentMessages)
		.where(
			and(
				eq(agentMessages.projectId, projectId),
				eq(agentMessages.userId, userId),
			),
		)
		.orderBy(asc(agentMessages.createdAt), asc(agentMessages.id))
		.limit(limit);
}

/**
 * AI-6a §8a fix 5: counts this user's turns for one project in the last
 * rolling hour — the chat route's rate-limit check, mirroring
 * `generation-task.repository.ts::countSince`'s shape. Scoped to role "user"
 * (not every persisted row): each user-authored message is one billable
 * agent turn; assistant rows persisted alongside it aren't a second turn.
 */
export async function countUserMessagesSince(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
	since: Date,
): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(agentMessages)
		.where(
			and(
				eq(agentMessages.projectId, projectId),
				eq(agentMessages.userId, userId),
				eq(agentMessages.role, "user"),
				gte(agentMessages.createdAt, since),
			),
		);
	return row?.value ?? 0;
}
