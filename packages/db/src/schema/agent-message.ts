import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id } from "../shared/id";
import { tenantIsolationPolicy } from "../shared/rls";
import { projects } from "./project";
import { user } from "./user";

// The Studio agent's per-project chat log (docs ai-architecture-v1.md §2
// "Chat semantics"): history is per PROJECT, not per version — the
// conversation drives the project's evolution ACROSS renders. `parts` stores
// the AI SDK `UIMessage["parts"]` array verbatim (text/tool-call/tool-result
// parts as streamed) so the sidebar can replay a turn exactly as it was
// rendered live, without re-deriving it from a flattened string. Typed loosely
// (`unknown[]`) rather than a packages/types shape: the AI SDK owns that
// union's evolution (new part kinds land in `ai` version bumps), and this
// table is a verbatim log, not a contract this repo controls.
export const agentMessages = pgTable(
	"agent_messages",
	{
		id: id(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// Denormalized owner (docs §5d.1).
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		parts: jsonb("parts").$type<unknown[]>().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// The sidebar's read pattern: all messages for one project, oldest
		// first — a composite index on exactly that pair.
		index("agent_messages_project_id_created_at_idx").on(
			table.projectId,
			table.createdAt,
		),
		index("agent_messages_user_id_idx").on(table.userId),
		tenantIsolationPolicy(),
	],
).enableRLS();
