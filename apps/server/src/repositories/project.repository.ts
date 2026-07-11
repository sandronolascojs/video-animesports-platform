import type { UserScopedTx } from "@video-platform-challenge/db";
import { projects } from "@video-platform-challenge/db/schema";
import type {
	SubtitleStyle,
	TimelineEntry,
} from "@video-platform-challenge/types";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

// Every query here filters by userId explicitly on top of running inside a
// withUser() transaction — RLS is the backstop, not the only wall (docs
// §5d.1, §5d.2).

export async function insertProject(
	tx: UserScopedTx,
	values: NewProjectRow,
): Promise<ProjectRow> {
	const [row] = await tx.insert(projects).values(values).returning();
	if (!row) {
		throw new Error("Failed to insert project row");
	}
	return row;
}

export async function findById(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<ProjectRow | null> {
	const [row] = await tx
		.select()
		.from(projects)
		.where(and(eq(projects.id, id), eq(projects.userId, userId)));
	return row ?? null;
}

/**
 * Same lookup as `findById`, plus `SELECT ... FOR UPDATE` (fix-pass B1): the
 * project row's lock is held for the rest of the transaction, serializing
 * every concurrent read-modify-write of `draft_timeline`/`status` against
 * this project (extend, updateDraftTimeline, scene remove/update, the
 * generation pipeline's timeline backfill). Use this instead of `findById`
 * at every call site that reads `draftTimeline` (or `status`) and later
 * writes it back in the same transaction.
 */
export async function findByIdForUpdate(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<ProjectRow | null> {
	const [row] = await tx
		.select()
		.from(projects)
		.where(and(eq(projects.id, id), eq(projects.userId, userId)))
		.for("update");
	return row ?? null;
}

/** Fix-pass B3: rolling-window quota check for `projects.create`. */
export async function countCreatedSince(
	tx: UserScopedTx,
	userId: string,
	since: Date,
): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(projects)
		.where(and(eq(projects.userId, userId), gte(projects.createdAt, since)));
	return row?.value ?? 0;
}

export async function findManyByUser(
	tx: UserScopedTx,
	userId: string,
	{ limit, offset }: { limit: number; offset: number },
): Promise<ProjectRow[]> {
	return tx
		.select()
		.from(projects)
		.where(eq(projects.userId, userId))
		.orderBy(desc(projects.createdAt))
		.limit(limit)
		.offset(offset);
}

export async function updateDraftTimeline(
	tx: UserScopedTx,
	userId: string,
	id: string,
	timeline: TimelineEntry[],
): Promise<ProjectRow | null> {
	const [row] = await tx
		.update(projects)
		.set({ draftTimeline: timeline })
		.where(and(eq(projects.id, id), eq(projects.userId, userId)))
		.returning();
	return row ?? null;
}

export async function updateSubtitleStyle(
	tx: UserScopedTx,
	userId: string,
	id: string,
	subtitleStyle: SubtitleStyle,
): Promise<ProjectRow | null> {
	const [row] = await tx
		.update(projects)
		.set({ subtitleStyle })
		.where(and(eq(projects.id, id), eq(projects.userId, userId)))
		.returning();
	return row ?? null;
}

/**
 * Generic patch updater — used by the generation pipeline (phase 3b-2) to
 * update status/failReason/title/synopsis/styleBible/plan as the workflow
 * progresses, without a dedicated repository function per field.
 */
export async function updateById(
	tx: UserScopedTx,
	userId: string,
	id: string,
	patch: Partial<NewProjectRow>,
): Promise<ProjectRow | null> {
	const [row] = await tx
		.update(projects)
		.set(patch)
		.where(and(eq(projects.id, id), eq(projects.userId, userId)))
		.returning();
	return row ?? null;
}

export async function updateLanguages(
	tx: UserScopedTx,
	userId: string,
	id: string,
	patch: Partial<Pick<NewProjectRow, "audioLanguage" | "subtitleLanguage">>,
): Promise<ProjectRow | null> {
	const [row] = await tx
		.update(projects)
		.set(patch)
		.where(and(eq(projects.id, id), eq(projects.userId, userId)))
		.returning();
	return row ?? null;
}

export async function deleteById(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<ProjectRow | null> {
	const [row] = await tx
		.delete(projects)
		.where(and(eq(projects.id, id), eq(projects.userId, userId)))
		.returning();
	return row ?? null;
}

/**
 * Paginated card rows for the /projects page. `previewAssetId` is the
 * project's first READY scene video (falling back to the final render) via a
 * correlated subquery — one query, no per-row round trips.
 */
export async function pageProjects(
	tx: UserScopedTx,
	userId: string,
	query: {
		page: number;
		pageSize: number;
		sortBy?: string;
		sortDirection: "asc" | "desc";
		status?: ProjectRow["status"];
		templateKey?: ProjectRow["templateKey"];
	},
) {
	const previewAssetId = sql<string | null>`(
		select a.id from assets a
		where a.project_id = ${projects.id}
			and a.status = 'ready'
			and a.kind in ('scene_video', 'render')
		order by case a.kind when 'scene_video' then 0 else 1 end, a.created_at asc
		limit 1
	)`;

	const orderColumn =
		query.sortBy === "title" ? projects.title : projects.createdAt;
	const orderBy =
		query.sortDirection === "asc" ? asc(orderColumn) : desc(orderColumn);

	const items = await tx
		.select({
			id: projects.id,
			title: projects.title,
			status: projects.status,
			templateKey: projects.templateKey,
			createdAt: projects.createdAt,
			previewAssetId,
		})
		.from(projects)
		.where(
			and(
				eq(projects.userId, userId),
				query.status ? eq(projects.status, query.status) : undefined,
				query.templateKey
					? eq(projects.templateKey, query.templateKey)
					: undefined,
			),
		)
		.orderBy(orderBy)
		.limit(query.pageSize)
		.offset((query.page - 1) * query.pageSize);

	const [totalRow] = await tx
		.select({ total: count() })
		.from(projects)
		.where(
			and(
				eq(projects.userId, userId),
				query.status ? eq(projects.status, query.status) : undefined,
				query.templateKey
					? eq(projects.templateKey, query.templateKey)
					: undefined,
			),
		);

	return { items, total: totalRow?.total ?? 0 };
}
