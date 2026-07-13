import type { UserScopedTx } from "@video-platform-challenge/db";
import { assets, projects, scenes } from "@video-platform-challenge/db/schema";
import { AssetKind, AssetStatus } from "@video-platform-challenge/types";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";

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
 * The list/create summary card preview per project (docs §6
 * `projectSummarySchema.thumbnailAssetId`/`thumbnailKind`): the project's own
 * media, preferring the first READY scene video → final render → keyframe /
 * character sheet, so a card shows its actual footage rather than generic
 * template art. One `DISTINCT ON` query for the whole page of project ids —
 * never one query per project. Also reused by
 * `project.repository.ts::pageProjects` (the /projects page cards) with a
 * narrower `candidateKinds` — see that call site for why.
 *
 * `candidateKinds` is the allowed-kind filter (defaults to this function's
 * original 4 kinds). Priority order is NOT parameterized: scene_video always
 * outranks render, and every other allowed kind (keyframe, character_sheet,
 * or whatever a caller passes) ties for last place, broken by `createdAt`
 * ascending — same semantics as before this was parameterized.
 */
export async function findThumbnailsByProjectIds(
	tx: UserScopedTx,
	userId: string,
	projectIds: string[],
	candidateKinds: readonly AssetKind[] = [
		AssetKind.SCENE_VIDEO,
		AssetKind.RENDER,
		AssetKind.KEYFRAME,
		AssetKind.CHARACTER_SHEET,
	],
): Promise<Map<string, { id: string; kind: AssetKind; r2Key: string }>> {
	if (projectIds.length === 0) {
		return new Map();
	}

	// DISTINCT ON (project_id) keeps the first row per project under this order:
	// kind priority first (video beats stills, everything else ties for last —
	// there's no pure-builder CASE in drizzle, so this stays a minimal `sql`
	// fragment), then oldest — the earliest asset in that tier, so cards stay
	// stable as later assets land.
	const kindPriority = sql`case ${assets.kind}
		when ${AssetKind.SCENE_VIDEO} then 0
		when ${AssetKind.RENDER} then 1
		else 2 end`;

	const rows = await tx
		.selectDistinctOn([assets.projectId], {
			projectId: assets.projectId,
			id: assets.id,
			kind: assets.kind,
			r2Key: assets.r2Key,
		})
		.from(assets)
		.where(
			and(
				eq(assets.userId, userId),
				inArray(assets.projectId, projectIds),
				eq(assets.status, AssetStatus.READY),
				inArray(assets.kind, candidateKinds),
			),
		)
		.orderBy(assets.projectId, kindPriority, asc(assets.createdAt));

	return new Map(
		rows.map((row) => [
			row.projectId,
			// r2Key is nullable in general but NOT NULL for a READY asset (see the
			// column's doc comment: "Nullable until the generation completes") —
			// the WHERE above filters `status = READY`, so every row here has one.
			// biome-ignore lint/style/noNonNullAssertion: READY ⟹ r2Key present
			{ id: row.id, kind: row.kind, r2Key: row.r2Key! },
		]),
	);
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
			// Internal — the service signs `downloadUrl` from this then DROPs it;
			// r2Key never reaches the client.
			r2Key: assets.r2Key,
		})
		.from(assets)
		.innerJoin(projects, eq(assets.projectId, projects.id))
		.leftJoin(
			scenes,
			or(
				eq(scenes.videoAssetId, assets.id),
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
