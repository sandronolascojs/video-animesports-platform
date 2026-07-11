import type { AssetMetadata } from "@video-platform-challenge/types";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { assetKindEnum, assetStatusEnum } from "../shared/enums";
import { id } from "../shared/id";
import { tenantIsolationPolicy } from "../shared/rls";
import { projects } from "./project";
import { user } from "./user";

export const assets = pgTable(
	"assets",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// Denormalized owner (docs §5d.1) — every tenant table filters by this
		// directly, no join-walking through projects required.
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		kind: assetKindEnum("kind").notNull(),
		status: assetStatusEnum("status").notNull().default("pending"),
		// R2 object key, always prefixed users/{userId}/projects/{projectId}/…
		// Nullable until the generation that produces it completes.
		r2Key: text("r2_key"),
		contentType: text("content_type"),
		size: integer("size"),
		// Kind-specific metadata (width/height for images & video, duration for
		// video/audio) — a flat, concretely-typed shape (see AssetMetadata's
		// doc comment for why: Workflows' Rpc.Serializable<T> constraint can't
		// prove an unknown/Record<string,unknown> field serializable).
		metadata: jsonb("metadata").$type<AssetMetadata>(),
		// Fix-pass W1 (ingest half): the owning generation_tasks row's id —
		// the idempotency key for the generation that produced this asset
		// (docs §3, §6). Populated by every `ingestX` call in
		// generation.service.ts; a `step.do` replay of an ingest step looks up
		// an existing READY asset by this column (see `findBySource`) instead
		// of re-fetching from kie/re-uploading to R2/re-inserting a duplicate
		// row. Null for assets with no generation_tasks row (e.g. R1
		// browser-rendered `render` assets via `assets.createUpload`).
		source: text("source"),
		failReason: text("fail_reason"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("assets_project_id_idx").on(table.projectId),
		index("assets_user_id_idx").on(table.userId),
		index("assets_status_idx").on(table.status),
		// Fix-pass W1: unique (NULLs excepted — Postgres never treats two
		// NULLs as equal in a unique index, so render assets with no source
		// never collide) so the DB itself backstops the replay-guard's
		// invariant of at most one asset per generation_tasks row.
		uniqueIndex("assets_source_unique").on(table.source),
		tenantIsolationPolicy(),
	],
).enableRLS();
