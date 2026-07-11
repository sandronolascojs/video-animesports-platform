import type {
	ProjectPlan,
	SubtitleStyle,
	TimelineEntry,
} from "@video-platform-challenge/types";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
	aspectRatioEnum,
	audioLanguageEnum,
	projectStatusEnum,
	subtitleLanguageEnum,
	templateKeyEnum,
} from "../shared/enums";
import { id } from "../shared/id";
import { tenantIsolationPolicy } from "../shared/rls";
import { user } from "./user";

export const projects = pgTable(
	"projects",
	{
		id: id(),
		// Isolation root: every child table also denormalizes this user_id
		// rather than joining up through projects (see docs §5d.1).
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		templateKey: templateKeyEnum("template_key").notNull(),
		// The user's main story description — the core input (docs §1).
		description: text("description").notNull(),
		// title/synopsis are agent-assigned once the plan step runs.
		title: text("title"),
		synopsis: text("synopsis"),
		status: projectStatusEnum("status").notNull().default("draft"),
		// Chosen at creation; immutable by convention — no update path should
		// ever change this after the project is created (docs §5c.5).
		aspectRatio: aspectRatioEnum("aspect_ratio").notNull(),
		audioLanguage: audioLanguageEnum("audio_language").notNull(),
		subtitleLanguage: subtitleLanguageEnum("subtitle_language").notNull(),
		// Style tokens produced once by the plan agent, prepended to every
		// image/video prompt for the whole project (docs §2) — a fixed text
		// block (doc's own words), not an object; typed as `string` both for
		// accuracy and because an untyped/unknown jsonb column breaks
		// Workflows' Rpc.Serializable<T> constraint on step.do return values
		// (see AssetMetadata's doc comment in packages/types for the same
		// issue).
		styleBible: jsonb("style_bible").$type<string>(),
		// The plan agent's full output — characters/locations (with their sheet
		// asset ids, filled in as sheets complete) + per-scene character/
		// location metadata. There is no characters/locations/scene_characters
		// table in this schema version (deferred in phase 1); this is where
		// that data lives instead (docs §6, phase 3b-2 design anchor 2). Null
		// until the plan step completes.
		plan: jsonb("plan").$type<ProjectPlan>(),
		// Font/size/weight/color/outline/background/position — drives both the
		// Player overlay and the ASS burn-in track (docs §5b).
		subtitleStyle: jsonb("subtitle_style").$type<SubtitleStyle>(),
		// THE only ordering authority for scene sequence & composition. Scenes
		// carry no sort column; creation appends here, reorder/extend mutate
		// here, versions snapshot here (docs §6, §9).
		draftTimeline: jsonb("draft_timeline")
			.$type<TimelineEntry[]>()
			.notNull()
			.default([]),
		// Set when generation fails at the project level (e.g. the plan step
		// itself, or the workflow couldn't be started at all) — mirrors the
		// fail_reason column already on scenes/assets/project_versions (docs
		// phase 3b-2: the error-first smoke path asserts on this field).
		failReason: text("fail_reason"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("projects_user_id_idx").on(table.userId),
		index("projects_status_idx").on(table.status),
		tenantIsolationPolicy(),
	],
).enableRLS();
