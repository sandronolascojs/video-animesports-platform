import type { UserScopedTx } from "@video-platform-challenge/db";
import { projectVersions } from "@video-platform-challenge/db/schema";
import { VersionStatus } from "@video-platform-challenge/types";
import { and, count, desc, eq, gte } from "drizzle-orm";

export type VersionRow = typeof projectVersions.$inferSelect;
export type NewVersionRow = typeof projectVersions.$inferInsert;

export async function insertOne(
	tx: UserScopedTx,
	values: NewVersionRow,
): Promise<VersionRow> {
	const [row] = await tx.insert(projectVersions).values(values).returning();
	if (!row) {
		throw new Error("Failed to insert project_versions row");
	}
	return row;
}

/** WARNING fix: rolling-window quota check for `versions.render`, mirroring
 * `project.repository.ts::countCreatedSince` /
 * `generation-task.repository.ts::countSince`. */
export async function countCreatedSince(
	tx: UserScopedTx,
	userId: string,
	since: Date,
): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(projectVersions)
		.where(
			and(
				eq(projectVersions.userId, userId),
				gte(projectVersions.createdAt, since),
			),
		);
	return row?.value ?? 0;
}

export async function findById(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<VersionRow | null> {
	const [row] = await tx
		.select()
		.from(projectVersions)
		.where(and(eq(projectVersions.id, id), eq(projectVersions.userId, userId)));
	return row ?? null;
}

export async function findManyByProjectId(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<VersionRow[]> {
	return tx
		.select()
		.from(projectVersions)
		.where(
			and(
				eq(projectVersions.projectId, projectId),
				eq(projectVersions.userId, userId),
			),
		)
		.orderBy(desc(projectVersions.number));
}

export async function findLatestByProjectId(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<VersionRow | null> {
	const [row] = await tx
		.select()
		.from(projectVersions)
		.where(
			and(
				eq(projectVersions.projectId, projectId),
				eq(projectVersions.userId, userId),
			),
		)
		.orderBy(desc(projectVersions.number))
		.limit(1);
	return row ?? null;
}

export async function findRenderingByProjectId(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<VersionRow | null> {
	const [row] = await tx
		.select()
		.from(projectVersions)
		.where(
			and(
				eq(projectVersions.projectId, projectId),
				eq(projectVersions.userId, userId),
				eq(projectVersions.status, VersionStatus.RENDERING),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function updateStatus(
	tx: UserScopedTx,
	userId: string,
	id: string,
	patch: Partial<NewVersionRow>,
): Promise<VersionRow | null> {
	const [row] = await tx
		.update(projectVersions)
		.set(patch)
		.where(and(eq(projectVersions.id, id), eq(projectVersions.userId, userId)))
		.returning();
	return row ?? null;
}
