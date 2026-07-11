import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import {
	generationTaskKindEnum,
	generationTaskStatusEnum,
} from "../shared/enums";
import { id } from "../shared/id";
import { serviceReadPolicy, tenantIsolationPolicy } from "../shared/rls";
import { projects } from "./project";
import { scenes } from "./scene";
import { user } from "./user";

// The task↔workflow mapping table (docs phase 3b-2 design anchor 1): one row
// per kie.ai createTask call. The webhook route looks up a row by
// `kieTaskId` (globally unique, indexed) to resolve which
// VideoGenerationWorkflow instance to `sendEvent` to — see
// serviceReadPolicy()'s doc comment for why this table carries a second,
// open SELECT policy alongside the standard tenant one.
export const generationTasks = pgTable(
	"generation_tasks",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// Null for project-level tasks (character/location sheets aren't tied
		// to one scene).
		sceneId: text("scene_id").references(() => scenes.id, {
			onDelete: "cascade",
		}),
		kieTaskId: text("kie_task_id").notNull(),
		workflowInstanceId: text("workflow_instance_id").notNull(),
		kind: generationTaskKindEnum("kind").notNull(),
		status: generationTaskStatusEnum("status").notNull().default("pending"),
		// kie.ai's `recordInfo.failCode`/`failMsg` (fix-pass C3) — the raw
		// provider failure detail. Kept here (not surfaced verbatim to the
		// user): scene/project fail_reason gets a static message + failCode
		// suffix only, the full failMsg stays server-side.
		failCode: text("fail_code"),
		failMsg: text("fail_msg"),
		// Deterministic idempotency key for the workflow step that created this
		// task, e.g. `${mode}:${projectId}:sheet:character:${name}` (fix-pass
		// W1). Unique so a step replay (Workflow retry re-running a `step.do`
		// whose write succeeded but whose return was lost) can look up and
		// reuse the existing kie task instead of double-billing a new one.
		// Nullable: only new call sites populate it going forward.
		stepKey: text("step_key"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("generation_tasks_user_id_idx").on(table.userId),
		index("generation_tasks_project_id_idx").on(table.projectId),
		uniqueIndex("generation_tasks_kie_task_id_unique").on(table.kieTaskId),
		uniqueIndex("generation_tasks_step_key_unique").on(table.stepKey),
		tenantIsolationPolicy(),
		serviceReadPolicy(),
	],
).enableRLS();
