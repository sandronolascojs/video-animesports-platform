import { ORPCError } from "@orpc/server";
import type {
	AssetDownloadUrl,
	Asset as AssetDto,
	AssetsPageInput,
	CreateUploadInput,
	CreateUploadOutput,
	GetAssetDownloadUrlInput,
} from "@video-platform-challenge/api";
import { db, withUser } from "@video-platform-challenge/db";
import {
	createSignedDownloadUrl,
	createSignedUploadUrl,
} from "@video-platform-challenge/storage";
import {
	AssetStatus,
	calculatePaginationMeta,
} from "@video-platform-challenge/types";

import type { Context } from "../lib/context";
import { buildRenderUploadR2Key } from "../lib/r2-keys";
import type { AssetRow } from "../repositories/asset.repository";
import * as assetRepository from "../repositories/asset.repository";
import * as projectRepository from "../repositories/project.repository";

type SessionUser = NonNullable<Context["session"]>;

// PUT URLs stay short-lived (docs §5d.10: "presigned URLs short-lived (PUT
// ≤15min...)") — the storage package's own default already matches this, so
// this is just documenting the bound createUpload relies on, not a
// different value.
const RENDER_UPLOAD_URL_TTL_SECONDS = 15 * 60;

// R2 stays private — the raw r2Key/source never leave this module (docs
// §5d.10). Every other surface only ever sees this shape.
export function toAssetDto(row: AssetRow): AssetDto {
	return {
		id: row.id,
		projectId: row.projectId,
		kind: row.kind,
		status: row.status,
		contentType: row.contentType,
		size: row.size,
		// Fix-pass W9d: row.metadata is already drizzle-typed AssetMetadata|null
		// (jsonb $type<AssetMetadata>()) — same shape assetSchema now validates,
		// no cast needed.
		metadata: row.metadata ?? null,
		failReason: row.failReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

type GetDownloadUrlOptions = {
	session: SessionUser;
} & GetAssetDownloadUrlInput;

export async function getDownloadUrl({
	session,
	id,
}: GetDownloadUrlOptions): Promise<AssetDownloadUrl> {
	const asset = await withUser(db, session.user.id, (tx) =>
		assetRepository.findById(tx, session.user.id, id),
	);

	// Missing, foreign-owned, or not-yet-generated (no r2Key) all read as the
	// same "nothing to download" state — never FORBIDDEN (docs §5d.6).
	if (!asset?.r2Key) {
		throw new ORPCError("NOT_FOUND");
	}

	const signed = await createSignedDownloadUrl({ key: asset.r2Key });
	return { url: signed.url, expiresAt: signed.expiresAt };
}

/**
 * Creates a pending `render`-kind asset row and issues a presigned PUT for
 * the browser-side Mediabunny remux/export flow (docs §5, §9 "MVP path
 * (browser)", phase 3b-2 design anchor 6). The row starts `pending` — it
 * only becomes `ready` once `versions.markRendered` verifies the real
 * uploaded object via a HEAD check (a presigned PUT alone cannot enforce
 * size/content-type, docs §5d.10).
 */
type CreateUploadOptions = { session: SessionUser } & CreateUploadInput;

export async function createUpload({
	session,
	projectId,
	contentType,
	size,
	kind,
}: CreateUploadOptions): Promise<CreateUploadOutput> {
	const userId = session.user.id;

	return withUser(db, userId, async (tx) => {
		const project = await projectRepository.findById(tx, userId, projectId);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const key = buildRenderUploadR2Key({ userId, projectId, contentType });

		const asset = await assetRepository.insertAsset(tx, {
			projectId,
			userId,
			kind,
			status: AssetStatus.PENDING,
			contentType,
			size,
			r2Key: key,
		});

		const signed = await createSignedUploadUrl({
			key,
			contentType,
			expiresInSeconds: RENDER_UPLOAD_URL_TTL_SECONDS,
		});

		return {
			assetId: asset.id,
			uploadUrl: signed.url,
			expiresAt: signed.expiresAt,
		};
	});
}

/**
 * Paginated cards for the /assets page — shared `{ items, meta }` envelope
 * (packages/types pagination contract).
 */
export async function page({
	session,
	...query
}: { session: SessionUser } & AssetsPageInput) {
	return withUser(db, session.user.id, async (tx) => {
		const { items, total } = await assetRepository.pageAssets(
			tx,
			session.user.id,
			query,
		);
		return {
			items,
			meta: calculatePaginationMeta(total, query.page, query.pageSize),
		};
	});
}
