import type { UserScopedTx } from "@video-platform-challenge/db";
import { scenes } from "@video-platform-challenge/db/schema";
import type { SceneStatus } from "@video-platform-challenge/types";
import { and, eq } from "drizzle-orm";

export type SceneRow = typeof scenes.$inferSelect;
export type NewSceneRow = typeof scenes.$inferInsert;

// Ownership is resolved by the scene's own denormalized userId (docs
// §5d.1) — every query filters by it directly, never by joining through
// projects.

export async function insertMany(
	tx: UserScopedTx,
	values: NewSceneRow[],
): Promise<SceneRow[]> {
	if (values.length === 0) {
		return [];
	}
	return tx.insert(scenes).values(values).returning();
}

export async function insertOne(
	tx: UserScopedTx,
	values: NewSceneRow,
): Promise<SceneRow> {
	const [row] = await tx.insert(scenes).values(values).returning();
	if (!row) {
		throw new Error("Failed to insert scene row");
	}
	return row;
}

export async function findById(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<SceneRow | null> {
	const [row] = await tx
		.select()
		.from(scenes)
		.where(and(eq(scenes.id, id), eq(scenes.userId, userId)));
	return row ?? null;
}

export async function findManyByProjectId(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<SceneRow[]> {
	return tx
		.select()
		.from(scenes)
		.where(and(eq(scenes.projectId, projectId), eq(scenes.userId, userId)));
}

export async function updateById(
	tx: UserScopedTx,
	userId: string,
	id: string,
	patch: Partial<NewSceneRow>,
): Promise<SceneRow | null> {
	const [row] = await tx
		.update(scenes)
		.set(patch)
		.where(and(eq(scenes.id, id), eq(scenes.userId, userId)))
		.returning();
	return row ?? null;
}

/**
 * Compare-and-swap update (fix-pass C1): only writes when the row's CURRENT
 * status matches `whereStatus`, in one atomic `UPDATE ... WHERE id AND
 * user_id AND status = $whereStatus RETURNING`. Closes the TOCTOU window a
 * separate "read status, then update" pair leaves open between two
 * concurrent `scenes.retry` calls — `null` means either the row doesn't
 * exist/isn't owned by this user (NOT_FOUND) or it existed but was no
 * longer in `whereStatus` (CONFLICT); the caller disambiguates with a
 * follow-up `findById` only on this (rare) failure path.
 */
export async function updateByIdWhereStatus(
	tx: UserScopedTx,
	userId: string,
	id: string,
	whereStatus: SceneStatus,
	patch: Partial<NewSceneRow>,
): Promise<SceneRow | null> {
	const [row] = await tx
		.update(scenes)
		.set(patch)
		.where(
			and(
				eq(scenes.id, id),
				eq(scenes.userId, userId),
				eq(scenes.status, whereStatus),
			),
		)
		.returning();
	return row ?? null;
}

export async function deleteById(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<SceneRow | null> {
	const [row] = await tx
		.delete(scenes)
		.where(and(eq(scenes.id, id), eq(scenes.userId, userId)))
		.returning();
	return row ?? null;
}
