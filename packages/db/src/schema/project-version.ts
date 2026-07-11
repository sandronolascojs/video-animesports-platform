import type { TimelineEntry } from "@video-platform-challenge/types";
import { VersionStatus } from "@video-platform-challenge/types";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { versionStatusEnum } from "../shared/enums";
import { id } from "../shared/id";
import { tenantIsolationPolicy } from "../shared/rls";
import { assets } from "./asset";
import { projects } from "./project";
import { user } from "./user";

export const projectVersions = pgTable(
	"project_versions",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// Denormalized owner (docs §5d.1).
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		// Immutable ordered snapshot at render time — same shape as
		// projects.draft_timeline (docs §6, §9). Rendering a version is
		// assembly-only; untouched clips are never regenerated.
		timeline: jsonb("timeline").$type<TimelineEntry[]>().notNull(),
		renderAssetId: text("render_asset_id").references(() => assets.id, {
			onDelete: "set null",
		}),
		status: versionStatusEnum("status").notNull().default("rendering"),
		failReason: text("fail_reason"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("project_versions_project_id_idx").on(table.projectId),
		index("project_versions_user_id_idx").on(table.userId),
		unique("project_versions_project_id_number_unique").on(
			table.projectId,
			table.number,
		),
		// Fix-pass C1: DB-level compare-and-swap backstop for the
		// findRenderingByProjectId-then-insert race in version.service.ts's
		// render() — at most one `rendering` row per project can ever exist,
		// even under concurrent requests. The service catches this unique
		// violation and turns it into CONFLICT (B2's abandon-reclaim logic
		// runs first and clears a stale `rendering` row before a fresh insert
		// is attempted, so this only fires on genuine concurrency).
		// `sql.raw` (not a bound param): a CREATE INDEX ... WHERE clause is DDL
		// — Postgres does not accept a query parameter there, so the enum
		// value must be inlined as a literal. Still sourced from
		// `VersionStatus.RENDERING` (never hand-typed) per this repo's "no
		// hardcoded enum strings" convention.
		uniqueIndex("project_versions_one_rendering_per_project")
			.on(table.projectId)
			.where(sql`${table.status} = ${sql.raw(`'${VersionStatus.RENDERING}'`)}`),
		tenantIsolationPolicy(),
	],
).enableRLS();
