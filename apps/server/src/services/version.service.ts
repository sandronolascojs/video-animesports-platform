import { ORPCError } from "@orpc/server";
import type {
	CancelVersionInput,
	CancelVersionOutput,
	ListVersionsInput,
	MarkVersionRenderedInput,
	RenderVersionInput,
	RestoreVersionInput,
	RestoreVersionOutput,
	Version as VersionDto,
} from "@video-platform-challenge/api";
import {
	generationFailedError,
	rateLimitedError,
} from "@video-platform-challenge/api";
import {
	db,
	isUniqueViolationError,
	withUser,
} from "@video-platform-challenge/db";
import { env } from "@video-platform-challenge/env/server";
import { headObject } from "@video-platform-challenge/storage";
import {
	AssetStatus,
	MAX_RENDER_UPLOAD_SIZE_BYTES,
	MAX_RENDERS_PER_HOUR,
	RENDER_ABANDON_MINUTES,
	VersionStatus,
} from "@video-platform-challenge/types";

import type { Context } from "../lib/context";
import { runMarkRendered } from "../lib/mark-rendered";
import { notifyProjectEvent } from "../lib/notify-project-event";
import { canRenderProject, RENDER_GUARD_MESSAGE } from "../lib/render-guard";
import * as assetRepository from "../repositories/asset.repository";
import * as projectRepository from "../repositories/project.repository";
import * as sceneRepository from "../repositories/scene.repository";
import type { VersionRow } from "../repositories/version.repository";
import * as versionRepository from "../repositories/version.repository";
import * as generationService from "./generation.service";

type SessionUser = NonNullable<Context["session"]>;

export function toVersionDto(row: VersionRow): VersionDto {
	return {
		id: row.id,
		projectId: row.projectId,
		number: row.number,
		timeline: row.timeline,
		renderAssetId: row.renderAssetId,
		status: row.status,
		failReason: row.failReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

const RENDER_ABANDON_MS = RENDER_ABANDON_MINUTES * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Snapshots the current draft timeline into a new immutable version and
 * kicks assembly. CONFLICT if the project already has a version currently
 * `rendering` (docs §9, contract doc-comment) — UNLESS that `rendering` row
 * is older than `RENDER_ABANDON_MINUTES`, in which case it's treated as
 * abandoned (the browser-driven R1 remux flow never called back with
 * `versions.markRendered`, e.g. the tab was closed mid-export): it's marked
 * `failed` here and render proceeds with a fresh version instead of
 * wedging the project's render slot forever (fix-pass B2). A subsequent
 * `markRendered` against the abandoned version already correctly CONFLICTs
 * (its status is no longer `rendering`) — no change needed there.
 *
 * The findRenderingByProjectId-then-insert sequence below is still a
 * TOCTOU window under real concurrency; `insertOne`'s catch is the DB-level
 * backstop (fix-pass C1 — a partial unique index allows at most one
 * `rendering` row per project, so a lost race surfaces as a unique
 * violation here, translated to CONFLICT).
 *
 * RT-1 (docs realtime-and-render-lock-v1.md §3): also CONFLICTs when the
 * project isn't `ready` or any of its scenes hasn't reached `video_ready`
 * yet — `lib/render-guard.ts`'s `canRenderProject`. The client's own
 * `canRender` preflight (use-render-export.tsx) already guards the button,
 * but this is the real safety net: it closes the agent's `render_version`
 * tool and any direct API call, not just the button.
 */
type RenderOptions = { session: SessionUser } & RenderVersionInput;

export async function render({
	session,
	projectId,
}: RenderOptions): Promise<VersionDto> {
	const row = await withUser(db, session.user.id, async (tx) => {
		const project = await projectRepository.findById(
			tx,
			session.user.id,
			projectId,
		);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const scenes = await sceneRepository.findManyByProjectId(
			tx,
			session.user.id,
			projectId,
		);
		if (!canRenderProject(project.status, scenes)) {
			throw new ORPCError("CONFLICT", { message: RENDER_GUARD_MESSAGE });
		}

		// WARNING fix (LIGHT touch): mirrors the other MAX_*_PER_HOUR
		// count-in-transaction guards (project create / generation kicks). A
		// render isn't billed kie.ai spend like those, but it IS real work
		// (an R1 browser Mediabunny remux round trip) — a client retry loop
		// shouldn't be able to spin it unbounded. `updateLanguages` is
		// deliberately left unrated: it's a cheap metadata-only update with
		// no generation/render work attached.
		const recentRenders = await versionRepository.countCreatedSince(
			tx,
			session.user.id,
			new Date(Date.now() - ONE_HOUR_MS),
		);
		if (recentRenders >= MAX_RENDERS_PER_HOUR) {
			throw new ORPCError("RATE_LIMITED", {
				status: rateLimitedError.status,
				message: rateLimitedError.message,
			});
		}

		const rendering = await versionRepository.findRenderingByProjectId(
			tx,
			session.user.id,
			projectId,
		);
		if (rendering) {
			const ageMs = Date.now() - rendering.createdAt.getTime();
			if (ageMs < RENDER_ABANDON_MS) {
				throw new ORPCError("CONFLICT");
			}
			await versionRepository.updateStatus(tx, session.user.id, rendering.id, {
				status: VersionStatus.FAILED,
				failReason: "Abandoned render (client never completed upload).",
			});
		}

		const latest = await versionRepository.findLatestByProjectId(
			tx,
			session.user.id,
			projectId,
		);
		const nextNumber = (latest?.number ?? 0) + 1;

		try {
			return await versionRepository.insertOne(tx, {
				projectId,
				userId: session.user.id,
				number: nextNumber,
				timeline: project.draftTimeline,
				status: VersionStatus.RENDERING,
			});
		} catch (error) {
			if (isUniqueViolationError(error)) {
				throw new ORPCError("CONFLICT");
			}
			throw error;
		}
	});

	await generationService.startRender(row.id, session.user.id);
	return toVersionDto(row);
}

/** Lists a project's versions, newest first — the History panel's source. */
type ListOptions = { session: SessionUser } & ListVersionsInput;

export async function list({
	session,
	projectId,
}: ListOptions): Promise<VersionDto[]> {
	return withUser(db, session.user.id, async (tx) => {
		const project = await projectRepository.findById(
			tx,
			session.user.id,
			projectId,
		);
		if (!project) {
			throw new ORPCError("NOT_FOUND");
		}

		const rows = await versionRepository.findManyByProjectId(
			tx,
			session.user.id,
			projectId,
		);
		return rows.map(toVersionDto);
	});
}

/**
 * Returns a version's timeline snapshot only — restoring never mutates the
 * version or the draft itself; the client applies it via
 * `projects.updateDraftTimeline` (docs §9, non-destructive history).
 */
type RestoreOptions = { session: SessionUser } & RestoreVersionInput;

export async function restore({
	session,
	id,
}: RestoreOptions): Promise<RestoreVersionOutput> {
	const version = await withUser(db, session.user.id, (tx) =>
		versionRepository.findById(tx, session.user.id, id),
	);
	if (!version) {
		throw new ORPCError("NOT_FOUND");
	}
	return { timeline: version.timeline };
}

/**
 * Marks a version's assembly complete and attaches the render asset — the
 * completion signal for the R1 browser Mediabunny remux flow (docs §5, §9).
 * Only `rendering` versions can be marked rendered (else CONFLICT); the
 * render asset must exist, belong to the caller, and be kind `render`.
 *
 * REN-2 (docs ai-architecture-v1.md §5 finding 2): the actual state-machine
 * decision — which failure paths transition the version (and the pending
 * asset, where applicable) to FAILED before throwing — lives in
 * lib/mark-rendered.ts's `runMarkRendered`, a pure/DI core unit-tested
 * directly (this wrapper just wires it to the real db/storage calls and
 * translates its outcome into the oRPC response). Every branch other than
 * "version not found" / "version not currently rendering" (docs finding 2's
 * own carve-out — nothing to transition either way) now ends FAILED, not
 * stuck `rendering` for the full abandon window.
 */
type MarkRenderedOptions = { session: SessionUser } & MarkVersionRenderedInput;

export async function markRendered({
	session,
	id,
	renderAssetId,
}: MarkRenderedOptions): Promise<VersionDto> {
	const userId = session.user.id;

	const outcome = await runMarkRendered(
		{
			maxUploadSizeBytes: MAX_RENDER_UPLOAD_SIZE_BYTES,
			renderAssetId,
			versionId: id,
		},
		{
			failAsset: async (assetId, failReason) => {
				await withUser(db, userId, (tx) =>
					assetRepository.updateById(tx, userId, assetId, {
						status: AssetStatus.FAILED,
						failReason,
					}),
				);
			},
			failVersion: async (versionId, failReason) => {
				await withUser(db, userId, (tx) =>
					versionRepository.updateStatus(tx, userId, versionId, {
						status: VersionStatus.FAILED,
						failReason,
					}),
				);
			},
			findAsset: (assetId) =>
				withUser(db, userId, (tx) =>
					assetRepository.findById(tx, userId, assetId),
				),
			findVersion: (versionId) =>
				withUser(db, userId, (tx) =>
					versionRepository.findById(tx, userId, versionId),
				),
			// A presigned PUT cannot itself enforce size/content-type (docs
			// §5d.10) — verify the REAL object before trusting the upload. Runs
			// OUTSIDE any DB transaction (an external R2 call), mirroring the
			// fetch/putObject-outside-tx pattern in generation.service.ts.
			headObject: (key) => headObject({ key }),
		},
	);

	if (outcome.type === "not_found") {
		throw new ORPCError("NOT_FOUND");
	}
	if (outcome.type === "conflict") {
		throw new ORPCError("CONFLICT");
	}
	if (outcome.type === "verification_failed") {
		throw new ORPCError("GENERATION_FAILED", {
			status: generationFailedError.status,
			message: generationFailedError.message,
			data: { reason: outcome.failReason },
		});
	}

	const versionDto = await withUser(db, userId, async (tx) => {
		await assetRepository.updateById(tx, userId, outcome.assetId, {
			status: AssetStatus.READY,
			size: outcome.head.size,
			contentType: outcome.head.contentType ?? outcome.fallbackContentType,
		});

		const row = await versionRepository.updateStatus(tx, userId, id, {
			status: VersionStatus.READY,
			renderAssetId: outcome.assetId,
		});
		if (!row) {
			throw new ORPCError("NOT_FOUND");
		}
		return toVersionDto(row);
	});

	// RT-3 (docs realtime-and-render-lock-v1.md §1 piece 4): broadcast AFTER
	// the transaction committed, mirroring generation.service.ts's own
	// "never inside the tx" rule — History updates live too, not just the
	// generating-state overlay.
	await notifyProjectEvent(env, {
		type: "version",
		projectId: versionDto.projectId,
		versionId: versionDto.id,
		status: versionDto.status,
		at: Date.now(),
	});

	return versionDto;
}

/**
 * REN-3 (docs ai-architecture-v1.md §5 finding 3): reconciles the server
 * row when the client's export `cancel()` fires — without this, an aborted
 * export left its `rendering` version alive for the full
 * `RENDER_ABANDON_MINUTES` window, CONFLICTing an immediate retry. Cancels
 * the project's CURRENT `rendering` version, if any, transitioning it
 * straight to `failed`. Idempotent and quiet: no version currently
 * rendering (or a foreign/nonexistent `projectId`, which `withUser`'s RLS
 * scoping resolves to the same "nothing found" shape) both just resolve
 * `canceled: false` — the client calls this fire-and-forget on every
 * cancel(), whether or not `render()` ever actually started.
 */
type CancelOptions = { session: SessionUser } & CancelVersionInput;

export async function cancel({
	session,
	projectId,
}: CancelOptions): Promise<CancelVersionOutput> {
	const userId = session.user.id;

	const canceledVersionId = await withUser(db, userId, async (tx) => {
		const rendering = await versionRepository.findRenderingByProjectId(
			tx,
			userId,
			projectId,
		);
		if (!rendering) {
			return null;
		}

		await versionRepository.updateStatus(tx, userId, rendering.id, {
			status: VersionStatus.FAILED,
			failReason: "canceled",
		});
		return rendering.id;
	});

	if (!canceledVersionId) {
		return { canceled: false };
	}

	// RT-3: same "broadcast after commit" rule as markRendered above.
	await notifyProjectEvent(env, {
		type: "version",
		projectId,
		versionId: canceledVersionId,
		status: VersionStatus.FAILED,
		at: Date.now(),
	});
	return { canceled: true };
}
