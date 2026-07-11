import type { UserScopedTx } from "@video-platform-challenge/db";
import { assets, projects, scenes } from "@video-platform-challenge/db/schema";
import { AssetKind, AssetStatus } from "@video-platform-challenge/types";
import { and, asc, count, desc, eq, inArray, or } from "drizzle-orm";

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;

export async function insertAsset(
	tx: UserScopedTx,
	values: NewAssetRow,
): Promise<AssetRow> {
	const [row] = await tx.insert(assets).values(values).returning();
	if (!row) {
		throw new Error("Failed to insert asset row");
	}
	return row;
}

export async function updateById(
	tx: UserScopedTx,
	userId: string,
	id: string,
	patch: Partial<NewAssetRow>,
): Promise<AssetRow | null> {
	const [row] = await tx
		.update(assets)
		.set(patch)
		.where(and(eq(assets.id, id), eq(assets.userId, userId)))
		.returning();
	return row ?? null;
}

export async function findById(
	tx: UserScopedTx,
	userId: string,
	id: string,
): Promise<AssetRow | null> {
	const [row] = await tx
		.select()
		.from(assets)
		.where(and(eq(assets.id, id), eq(assets.userId, userId)));
	return row ?? null;
}

/**
 * Fix-pass W1 (ingest half): looks up an existing asset by its `source`
 * column (the owning generation_tasks row's id, see that column's doc
 * comment) — the replay-guard every `ingestX` in generation.service.ts
 * checks before re-fetching from kie/re-uploading to R2. `assets` only
 * carries `tenantIsolationPolicy()` (no service-read exception like
 * generation_tasks), so this MUST run inside a `withUser` transaction like
 * every other query in this file.
 */
export async function findBySource(
	tx: UserScopedTx,
	userId: string,
	source: string,
): Promise<AssetRow | null> {
	const [row] = await tx
		.select()
		.from(assets)
		.where(and(eq(assets.userId, userId), eq(assets.source, source)))
		.limit(1);
	return row ?? null;
}

export async function findManyByProjectId(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<AssetRow[]> {
	return tx
		.select()
		.from(assets)
		.where(and(eq(assets.projectId, projectId), eq(assets.userId, userId)));
}

/**
 * The list/create summary card thumbnail: the earliest READY
 * character-sheet/keyframe asset per project (docs §6
 * `projectSummarySchema.thumbnailAssetId`). One `DISTINCT ON` query for the
 * whole page of project ids — never one query per project.
 */
export async function findThumbnailsByProjectIds(
	tx: UserScopedTx,
	userId: string,
	projectIds: string[],
): Promise<Map<string, string>> {
	if (projectIds.length === 0) {
		return new Map();
	}

	const rows = await tx
		.selectDistinctOn([assets.projectId], {
			projectId: assets.projectId,
			id: assets.id,
		})
		.from(assets)
		.where(
			and(
				eq(assets.userId, userId),
				inArray(assets.projectId, projectIds),
				eq(assets.status, AssetStatus.READY),
				inArray(assets.kind, [AssetKind.CHARACTER_SHEET, AssetKind.KEYFRAME]),
			),
		)
		.orderBy(assets.projectId, asc(assets.createdAt));

	return new Map(rows.map((row) => [row.projectId, row.id]));
}

/**
 * Paginated card rows for the /assets page — each asset joined with its
 * project (title/template for the card + modal) and its owning scene's
 * prompt (an asset hangs off at most one scene FK). Optional kind filter.
 */
export async function pageAssets(
	tx: UserScopedTx,
	userId: string,
	query: {
		page: number;
		pageSize: number;
		sortBy?: string;
		sortDirection: "asc" | "desc";
		kind?: AssetKind;
		status?: AssetStatus;
	},
) {
	const where = and(
		eq(assets.userId, userId),
		query.kind ? eq(assets.kind, query.kind) : undefined,
		query.status ? eq(assets.status, query.status) : undefined,
	);

	const orderColumn = query.sortBy === "kind" ? assets.kind : assets.createdAt;
	const orderBy =
		query.sortDirection === "asc" ? asc(orderColumn) : desc(orderColumn);

	const items = await tx
		.select({
			id: assets.id,
			kind: assets.kind,
			status: assets.status,
			createdAt: assets.createdAt,
			projectId: assets.projectId,
			projectTitle: projects.title,
			projectTemplateKey: projects.templateKey,
			scenePrompt: scenes.prompt,
		})
		.from(assets)
		.innerJoin(projects, eq(assets.projectId, projects.id))
		.leftJoin(
			scenes,
			or(
				eq(scenes.videoAssetId, assets.id),
				eq(scenes.audioAssetId, assets.id),
				eq(scenes.startKeyframeAssetId, assets.id),
				eq(scenes.endKeyframeAssetId, assets.id),
			),
		)
		.where(where)
		.orderBy(orderBy)
		.limit(query.pageSize)
		.offset((query.page - 1) * query.pageSize);

	const [totalRow] = await tx
		.select({ total: count() })
		.from(assets)
		.where(where);

	return { items, total: totalRow?.total ?? 0 };
}
