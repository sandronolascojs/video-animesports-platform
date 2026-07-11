import { sql } from "drizzle-orm";
import { pgPolicy } from "drizzle-orm/pg-core";

// Every tenant table (projects, scenes, assets, project_versions, …) gets
// the exact same row-level-security policy: a row is visible/writable only
// when its user_id matches the session-scoped `app.user_id` setting, which
// withUser() sets via SET LOCAL for the lifetime of one transaction.
//
// Centralized so all tenant tables enforce the identical rule byte-for-byte
// — a copy/paste drift here would be a silent isolation bug.
// See docs/video-engine-architecture.md §5d.
export const tenantIsolationPolicy = () =>
	pgPolicy("tenant_isolation", {
		for: "all",
		using: sql`user_id = current_setting('app.user_id', true)`,
		withCheck: sql`user_id = current_setting('app.user_id', true)`,
	});

// SELECT-only, deliberately open policy — used ONLY by generation_tasks
// (docs phase 3b-2 design anchor 1 & 4). The kie.ai webhook route has no
// session (it's server-to-server HMAC, docs §5d rule "NO auth middleware on
// this route") and must resolve a bare kie taskId back to its owning userId
// BEFORE it can run inside withUser() — a chicken-and-egg problem
// tenantIsolationPolicy() alone can't solve.
//
// Postgres OR's together permissive policies for the same command, so
// layering this alongside tenantIsolationPolicy() on the same table makes
// SELECT unrestricted while INSERT/UPDATE/DELETE stay governed by
// tenant_isolation (`for: "all"` still applies to those, since this policy
// is scoped to `for: "select"` only).
//
// Deliberately narrow blast radius: generation_tasks' columns are internal
// identifiers only (ids, a kie taskId, a workflow instance id, a kind/status
// enum) — no prompts, no secrets, no user-facing content. Flagged as a
// scoped, documented exception in the phase report, not a general pattern —
// no other tenant table should reach for this.
export const serviceReadPolicy = () =>
	pgPolicy("service_lookup_by_task_id", {
		for: "select",
		using: sql`true`,
	});
