import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sceneStatusEnum } from "../shared/enums";
import { id } from "../shared/id";
import { tenantIsolationPolicy } from "../shared/rls";
import { assets } from "./asset";
import { projects } from "./project";
import { user } from "./user";

export const scenes = pgTable(
	"scenes",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// Denormalized owner (docs §5d.1).
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title"),
		prompt: text("prompt").notNull(),
		// Audio-language spoken line — Seedance speaks it natively in the scene
		// video (`generate_audio: true` + the prompt's dialogue clause, docs
		// studio-fixes-backlog.md).
		dialogue: text("dialogue"),
		// Name of the plan character delivering `dialogue` — surfaced in the
		// video prompt for clarity. Null when the scene is silent or the line
		// is ensemble/off-screen.
		speakerName: text("speaker_name"),
		// Subtitle-language caption text, burned in at render time (docs §5b).
		subtitleText: text("subtitle_text"),
		status: sceneStatusEnum("status").notNull().default("planned"),
		durationSeconds: integer("duration_seconds").notNull(),
		// Keyframe fencing: scene i is generated first=Ki, last=Ki+1, so it
		// seamlessly chains into the next scene's start (docs §2).
		startKeyframeAssetId: text("start_keyframe_asset_id").references(
			() => assets.id,
			{ onDelete: "set null" },
		),
		endKeyframeAssetId: text("end_keyframe_asset_id").references(
			() => assets.id,
			{ onDelete: "set null" },
		),
		videoAssetId: text("video_asset_id").references(() => assets.id, {
			onDelete: "set null",
		}),
		failReason: text("fail_reason"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		// NOTE: deliberately no sort/order column — projects.draft_timeline is
		// the ONLY ordering authority (docs §6, §9). Do not add one here.
	},
	(table) => [
		index("scenes_project_id_idx").on(table.projectId),
		index("scenes_user_id_idx").on(table.userId),
		index("scenes_status_idx").on(table.status),
		tenantIsolationPolicy(),
	],
).enableRLS();
